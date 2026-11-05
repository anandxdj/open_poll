import { describe, expect, test } from "bun:test";
import {
  buildManifests,
  checkXmlWellFormed,
  manifestValues,
  renderTemplate,
  validateOfficeManifest,
  validateTeamsManifest,
  zipStore,
} from "../../../addins/scripts/build-manifests";
import { parseScreenLink, screenLinkUrl } from "@/features/embeds/screenLink";
import { teamsSidePanelUrl, teamsStageUrl } from "@/features/embeds/addins/teams";

const ORIGIN = "https://openpoll.example";
const DECK = "64b7f0c2a1b2c3d4e5f60718";
const TOKEN = `scr_${"a".repeat(43)}`;
const IDS = { powerpointId: "3be192f8-30ea-4aa4-8d22-98225adf97ee", teamsId: "ea6ed497-9a53-49eb-a208-22e90272e819" };

describe("screen links (add-in panes)", () => {
  test("accept this site's stage links, absolute or as a path", () => {
    const expected = { presentationId: DECK, screenToken: TOKEN };
    expect(parseScreenLink(`${ORIGIN}/embed/stage/${DECK}?token=${TOKEN}`, ORIGIN)).toEqual(expected);
    expect(parseScreenLink(`  /embed/stage/${DECK}/?token=${TOKEN} `, ORIGIN)).toEqual(expected);
    expect(screenLinkUrl(ORIGIN, expected)).toBe(`${ORIGIN}/embed/stage/${DECK}?token=${TOKEN}`);
  });

  test("refuse other sites, other pages and malformed tokens", () => {
    for (const link of [
      "",
      `https://evil.example/embed/stage/${DECK}?token=${TOKEN}`,
      `${ORIGIN}/embed/live/123456`,
      `${ORIGIN}/embed/stage/${DECK}`,
      `${ORIGIN}/embed/stage/${DECK}?token=scr_short`,
      `${ORIGIN}/embed/stage/not-a-deck?token=${TOKEN}`,
      "javascript:alert(1)",
    ]) {
      expect(parseScreenLink(link, ORIGIN)).toBeNull();
    }
  });

  test("the Teams tab and stage pages carry the link", () => {
    const link = `${ORIGIN}/embed/stage/${DECK}?token=${TOKEN}`;
    expect(teamsSidePanelUrl(ORIGIN, link)).toBe(`${ORIGIN}/addins/teams/sidepanel?link=${encodeURIComponent(link)}`);
    expect(teamsStageUrl(ORIGIN, link)).toBe(`${ORIGIN}/addins/teams/stage?link=${encodeURIComponent(link)}`);
  });
});

describe("add-in manifests", () => {
  const built = buildManifests(manifestValues({ origin: ORIGIN, version: "1.2.3", ...IDS }));

  test("both templates render and pass their checks", () => {
    expect(built.errors).toEqual([]);
    expect(built.powerpoint).toContain(`<Id>${IDS.powerpointId}</Id>`);
    expect(built.powerpoint).toContain("<Version>1.2.3.0</Version>");
    expect(built.powerpoint).toContain(`<SourceLocation DefaultValue="${ORIGIN}/addins/powerpoint"/>`);
    expect(built.teams).toMatchObject({
      id: IDS.teamsId,
      version: "1.2.3",
      validDomains: ["openpoll.example"],
      configurableTabs: [{ configurationUrl: `${ORIGIN}/addins/teams/config` }],
    });
  });

  test("values are checked: https origins, GUIDs, versions", () => {
    expect(() => manifestValues({ origin: "http://openpoll.example", ...IDS })).toThrow("https");
    expect(manifestValues({ origin: "http://localhost:3000", dev: true, ...IDS }).APP_ORIGIN).toBe("http://localhost:3000");
    expect(() => manifestValues({ origin: `${ORIGIN}/app`, ...IDS })).toThrow("without a path");
    expect(() => manifestValues({ origin: ORIGIN, version: "1.0", ...IDS })).toThrow("1.0.0");
    expect(() => manifestValues({ origin: ORIGIN, powerpointId: "nope", teamsId: IDS.teamsId })).toThrow("GUID");
    // Without ids a fresh GUID is made (the script prints it to keep).
    expect(manifestValues({ origin: ORIGIN }).TEAMS_APP_ID).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("templates refuse unknown placeholders and escape values", () => {
    expect(() => renderTemplate("{{NOPE}}", {})).toThrow("Unknown placeholder");
    const xml = buildManifests(manifestValues({ origin: ORIGIN, provider: 'A & "B" <C>', ...IDS })).powerpoint;
    expect(xml).toContain("<ProviderName>A &amp; &quot;B&quot; &lt;C&gt;</ProviderName>");
  });

  test("the Office checks catch broken manifests", () => {
    expect(checkXmlWellFormed('<?xml version="1.0" encoding="UTF-8"?><a><b></a>')).not.toEqual([]);
    expect(checkXmlWellFormed('<?xml version="1.0" encoding="UTF-8"?><!-- a -- b --><a/>')).toContain('A comment contains "--", which XML forbids');
    const swapped = built.powerpoint.replace("<Permissions>ReadWriteDocument</Permissions>", "<Permissions>Everything</Permissions>");
    expect(validateOfficeManifest(swapped, ORIGIN)).toContain("<Permissions> must be one of the Office permission levels");
    const foreign = built.powerpoint.replace(`${ORIGIN}/addins/powerpoint"/>\n  </DefaultSettings>`, 'https://evil.example/x"/>\n  </DefaultSettings>');
    expect(validateOfficeManifest(foreign, ORIGIN)).toContain("URL not on https://openpoll.example: https://evil.example/x");
    const reordered = built.powerpoint.replace(/\n {2}<DefaultLocale>en-US<\/DefaultLocale>/, "").replace("</Permissions>", "</Permissions>\n  <DefaultLocale>en-US</DefaultLocale>");
    expect(validateOfficeManifest(reordered, ORIGIN).some((e) => e.includes("must come after"))).toBe(true);
    const dangling = built.powerpoint.replace('resid="OpenPoll.Button.Tooltip"', 'resid="OpenPoll.Missing"');
    expect(validateOfficeManifest(dangling, ORIGIN)).toContain('resid "OpenPoll.Missing" has no resource');
  });

  test("the Teams checks catch broken manifests", () => {
    const teams = structuredClone(built.teams) as Record<string, unknown>;
    expect(validateTeamsManifest({ ...teams, validDomains: ["https://openpoll.example"] }, ORIGIN)).toEqual(
      expect.arrayContaining(["validDomains must include openpoll.example", "validDomains takes hosts, not URLs"])
    );
    expect(validateTeamsManifest({ ...teams, name: { short: "x".repeat(31) } }, ORIGIN)).toContain(
      "name.short is required, 30 characters at most"
    );
    expect(validateTeamsManifest({ ...teams, authorization: {} }, ORIGIN)[0]).toContain("MeetingStage.Write.Chat");
    expect(validateTeamsManifest({ ...teams, id: "x" }, ORIGIN)).toContain("id must be a GUID");
  });

  test("the Teams package is a valid ZIP with the manifest and both icons", () => {
    const files = [
      { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(built.teams)) },
      { name: "color.png", data: new Uint8Array([1, 2, 3]) },
    ];
    const zip = zipStore(files);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(2);
    // Stored entries: the first file's bytes follow its local header verbatim.
    const nameLength = view.getUint16(26, true);
    const json = new TextDecoder().decode(zip.subarray(30 + nameLength, 30 + nameLength + files[0]!.data.length));
    expect(JSON.parse(json).id).toBe(IDS.teamsId);
  });
});
