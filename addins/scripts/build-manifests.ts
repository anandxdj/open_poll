/**
 * Builds the add-in manifests (W4-D) from their templates and checks them.
 *
 *   bun addins/scripts/build-manifests.ts --origin https://openpoll.example \
 *     [--version 1.0.0] [--provider "Open Poll"] [--support https://…/support] [--out addins/dist]
 *
 * Ids: POWERPOINT_ADDIN_ID and TEAMS_APP_ID (GUIDs, from the environment or
 * --powerpoint-id / --teams-id). They must stay the same for the life of the
 * add-in; without them a new GUID is made and printed: keep it.
 *
 * Writes (under --out, default addins/dist, git-ignored):
 *   powerpoint/manifest.xml         sideload or upload to the Microsoft 365 admin center
 *   teams/manifest.json + icons     and teams/open-poll-teams.zip, the package Teams takes
 *
 * Checks are structural (required elements and fields, formats, URLs on the
 * origin, element order of the Office manifest, Teams limits). Microsoft's own
 * validators go further: `npx office-addin-manifest validate manifest.xml`
 * and the Teams Developer Portal's validation (docs/integrations/*.md).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32 } from "./make-icons";

export const ADDINS_DIR = path.resolve(import.meta.dir, "..");

export interface ManifestValues {
  /** https origin of the frontend (http://localhost… allowed with `dev`). */
  APP_ORIGIN: string;
  /** Host of APP_ORIGIN (Teams `validDomains`). */
  APP_HOST: string;
  /** Semantic version (Teams); the Office version is this plus ".0". */
  VERSION: string;
  OFFICE_VERSION: string;
  PROVIDER_NAME: string;
  SUPPORT_URL: string;
  POWERPOINT_ADDIN_ID: string;
  TEAMS_APP_ID: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEMVER = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const OFFICE_VERSION = /^\d{1,5}\.\d{1,5}\.\d{1,5}\.\d{1,5}$/;

/** `{{NAME}}` → value; every placeholder must be known (an unknown one is an error, not an empty string). */
export function renderTemplate(template: string, values: Record<string, string>, escape: (value: string) => string = (v) => v): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, name: string) => {
    if (!Object.hasOwn(values, name)) throw new Error(`Unknown placeholder {{${name}}}`);
    return escape(values[name]!);
  });
}

export const escapeXml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const escapeJsonString = (value: string) => JSON.stringify(value).slice(1, -1);

/** Values from options, checked: an https origin (or localhost with `dev`), GUIDs, versions. */
export function manifestValues(options: {
  origin: string;
  version?: string;
  provider?: string;
  support?: string;
  powerpointId?: string;
  teamsId?: string;
  dev?: boolean;
}): ManifestValues {
  let url: URL;
  try {
    url = new URL(options.origin);
  } catch {
    throw new Error(`--origin must be a URL, got "${options.origin}"`);
  }
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("--origin must be an origin, without a path");
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(options.dev && local)) {
    throw new Error("--origin must be https (Office, Teams and Zoom refuse plain http; use --dev for http://localhost)");
  }
  const version = options.version ?? "1.0.0";
  if (!SEMVER.test(version)) throw new Error(`--version must look like 1.0.0, got "${version}"`);
  const powerpointId = options.powerpointId ?? randomUUID();
  const teamsId = options.teamsId ?? randomUUID();
  for (const [name, id] of [
    ["POWERPOINT_ADDIN_ID", powerpointId],
    ["TEAMS_APP_ID", teamsId],
  ] as const) {
    if (!GUID.test(id)) throw new Error(`${name} must be a GUID, got "${id}"`);
  }
  return {
    APP_ORIGIN: url.origin,
    APP_HOST: url.host,
    VERSION: version,
    OFFICE_VERSION: `${version}.0`,
    PROVIDER_NAME: options.provider ?? "Open Poll",
    SUPPORT_URL: options.support ?? `${url.origin}/`,
    POWERPOINT_ADDIN_ID: powerpointId,
    TEAMS_APP_ID: teamsId,
  };
}

// ---------------------------------------------------------------------------
// Office (PowerPoint) manifest
// ---------------------------------------------------------------------------

/** Minimal XML well-formedness: every tag closes in order, attributes are quoted. */
export function checkXmlWellFormed(xml: string): string[] {
  const errors: string[] = [];
  for (const comment of xml.matchAll(/<!--([\s\S]*?)-->/g)) {
    if (comment[1]!.includes("--")) errors.push('A comment contains "--", which XML forbids');
  }
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) errors.push("Must start with the XML declaration");
  const body = xml.replace(/<\?xml[\s\S]*?\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (let match = tag.exec(body); match; match = tag.exec(body)) {
    const between = body.slice(last, match.index);
    if (/[<>]/.test(between)) errors.push(`Malformed markup near "${between.trim().slice(0, 40)}"`);
    last = tag.lastIndex;
    const [, closing, name, , selfClosing] = match;
    if (closing) {
      const open = stack.pop();
      if (open !== name) errors.push(`</${name}> closes <${open ?? "nothing"}>`);
    } else if (!selfClosing) {
      stack.push(name!);
    }
  }
  if (/[<>]/.test(body.slice(last))) errors.push("Malformed markup at the end");
  if (stack.length) errors.push(`Unclosed <${stack.join(">, <")}>`);
  return errors;
}

/** The text of the first `<name>…</name>` or the DefaultValue of `<name DefaultValue="…"/>`. */
const xmlValue = (xml: string, name: string): string | null => {
  const text = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  if (text) return text[1]!.trim();
  const attr = new RegExp(`<${name}\\s+DefaultValue="([^"]*)"`).exec(xml);
  return attr ? attr[1]! : null;
};

/** Top-level elements of the OfficeApp schema, in the order it requires (those this add-in uses). */
const OFFICE_ORDER = [
  "Id",
  "Version",
  "ProviderName",
  "DefaultLocale",
  "DisplayName",
  "Description",
  "IconUrl",
  "HighResolutionIconUrl",
  "SupportUrl",
  "AppDomains",
  "Hosts",
  "DefaultSettings",
  "Permissions",
  "VersionOverrides",
];

export function validateOfficeManifest(xml: string, origin: string): string[] {
  const errors = checkXmlWellFormed(xml);
  if (/\{\{[A-Z_]+\}\}/.test(xml)) errors.push("Unfilled placeholder");
  if (!/<OfficeApp[\s\S]*?xsi:type="TaskPaneApp"/.test(xml)) errors.push('Root must be <OfficeApp xsi:type="TaskPaneApp">');
  if (!xml.includes('xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"')) errors.push("Missing the appforoffice 1.1 namespace");

  const id = xmlValue(xml, "Id");
  if (!id || !GUID.test(id)) errors.push("<Id> must be a GUID");
  const version = xmlValue(xml, "Version");
  if (!version || !OFFICE_VERSION.test(version)) errors.push("<Version> must be n.n.n.n");
  for (const name of ["ProviderName", "DefaultLocale", "DisplayName", "Description"]) {
    if (!xmlValue(xml, name)) errors.push(`<${name}> is required`);
  }
  const display = xmlValue(xml, "DisplayName") ?? "";
  if (display.length > 125) errors.push("<DisplayName> is longer than 125 characters");
  const description = xmlValue(xml, "Description") ?? "";
  if (description.length > 250) errors.push("<Description> is longer than 250 characters");
  if (!/<Host Name="Presentation"\s*\/>/.test(xml)) errors.push('<Hosts> must contain <Host Name="Presentation"/>');
  if (!/<Permissions>(Restricted|ReadDocument|ReadWriteDocument|ReadAllDocument|WriteDocument)<\/Permissions>/.test(xml)) {
    errors.push("<Permissions> must be one of the Office permission levels");
  }
  const source = /<SourceLocation DefaultValue="([^"]+)"/.exec(xml)?.[1];
  if (!source) errors.push("<DefaultSettings><SourceLocation> is required");

  // Every URL lives on the app's origin, over https unless it is a local preview.
  for (const match of xml.matchAll(/DefaultValue="(https?:\/\/[^"]+)"/g)) {
    const url = match[1]!;
    if (new URL(url).origin !== origin) errors.push(`URL not on ${origin}: ${url}`);
  }
  if (!xml.includes(`<AppDomain>${origin}</AppDomain>`)) errors.push(`<AppDomains> must list ${origin}`);

  // Top-level order.
  const root = xml.slice(xml.indexOf("<OfficeApp"));
  const positions = OFFICE_ORDER.map((name) => ({ name, at: root.search(new RegExp(`\\n  <${name}[\\s>/]`)) }));
  for (const { name, at } of positions) {
    if (at < 0 && name !== "VersionOverrides") errors.push(`<${name}> is missing at the top level`);
  }
  const present = positions.filter((p) => p.at >= 0);
  for (let i = 1; i < present.length; i++) {
    if (present[i]!.at < present[i - 1]!.at) errors.push(`<${present[i]!.name}> must come after <${present[i - 1]!.name}>`);
  }

  // Ribbon resources: every resid points at a defined resource.
  const ids = new Set([...xml.matchAll(/<bt:(?:Image|Url|String) id="([^"]+)"/g)].map((m) => m[1]));
  for (const match of xml.matchAll(/resid="([^"]+)"/g)) {
    if (!ids.has(match[1]!)) errors.push(`resid "${match[1]}" has no resource`);
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Teams manifest
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const TEAMS_CONTEXTS = new Set([
  "channelTab",
  "privateChatTab",
  "meetingChatTab",
  "meetingDetailsTab",
  "meetingSidePanel",
  "meetingStage",
  "personalTab",
]);

export function validateTeamsManifest(manifest: Json, origin: string): string[] {
  const errors: string[] = [];
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const host = new URL(origin).host;
  const text = JSON.stringify(manifest);
  if (/\{\{[A-Z_]+\}\}/.test(text)) errors.push("Unfilled placeholder");

  if (manifest.manifestVersion !== "1.16") errors.push('manifestVersion must be "1.16"');
  if (!String(manifest.$schema ?? "").includes("/v1.16/")) errors.push("$schema must be the v1.16 schema");
  if (!SEMVER.test(str(manifest.version))) errors.push("version must be n.n.n");
  if (!GUID.test(str(manifest.id))) errors.push("id must be a GUID");

  const developer = (manifest.developer ?? {}) as Json;
  for (const field of ["name", "websiteUrl", "privacyUrl", "termsOfUseUrl"]) {
    if (!str(developer[field])) errors.push(`developer.${field} is required`);
  }
  for (const field of ["websiteUrl", "privacyUrl", "termsOfUseUrl"]) {
    if (str(developer[field]) && !str(developer[field]).startsWith(origin)) errors.push(`developer.${field} must be on ${origin}`);
  }

  const name = (manifest.name ?? {}) as Json;
  if (!str(name.short) || str(name.short).length > 30) errors.push("name.short is required, 30 characters at most");
  if (str(name.full).length > 100) errors.push("name.full is 100 characters at most");
  const description = (manifest.description ?? {}) as Json;
  if (!str(description.short) || str(description.short).length > 80) errors.push("description.short is required, 80 characters at most");
  if (!str(description.full) || str(description.full).length > 4000) errors.push("description.full is required, 4000 characters at most");

  const icons = (manifest.icons ?? {}) as Json;
  if (!str(icons.color) || !str(icons.outline)) errors.push("icons.color and icons.outline are required");
  if (!/^#[0-9a-f]{6}$/i.test(str(manifest.accentColor))) errors.push("accentColor must be #rrggbb");

  const tabs = Array.isArray(manifest.configurableTabs) ? (manifest.configurableTabs as Json[]) : [];
  if (tabs.length !== 1) errors.push("configurableTabs must hold exactly one tab");
  for (const tab of tabs) {
    if (!str(tab.configurationUrl).startsWith(`${origin}/`)) errors.push(`configurableTabs[].configurationUrl must be on ${origin}`);
    const scopes = Array.isArray(tab.scopes) ? (tab.scopes as string[]) : [];
    if (!scopes.length || scopes.some((s) => s !== "team" && s !== "groupChat")) errors.push("configurableTabs[].scopes must be team and/or groupChat");
    const contexts = Array.isArray(tab.context) ? (tab.context as string[]) : [];
    for (const context of contexts) if (!TEAMS_CONTEXTS.has(context)) errors.push(`Unknown tab context "${context}"`);
    for (const needed of ["meetingSidePanel", "meetingStage"]) {
      if (!contexts.includes(needed)) errors.push(`configurableTabs[].context must include ${needed}`);
    }
  }

  const domains = Array.isArray(manifest.validDomains) ? (manifest.validDomains as string[]) : [];
  if (!domains.includes(host)) errors.push(`validDomains must include ${host}`);
  if (domains.some((d) => d.includes("://") || d.includes("/"))) errors.push("validDomains takes hosts, not URLs");

  const rsc = ((((manifest.authorization ?? {}) as Json).permissions ?? {}) as Json).resourceSpecific;
  if (!Array.isArray(rsc) || !rsc.some((p) => (p as Json).name === "MeetingStage.Write.Chat")) {
    errors.push("authorization.permissions.resourceSpecific must grant MeetingStage.Write.Chat (share to stage)");
  }
  return errors;
}

// ---------------------------------------------------------------------------
// ZIP (stored, no compression): the Teams app package
// ---------------------------------------------------------------------------

export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, file.data.length, true);
    lv.setUint32(22, file.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, file.data);

    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, file.data.length, true);
    cv.setUint32(24, file.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuiltManifests {
  values: ManifestValues;
  powerpoint: string;
  teams: Json;
  errors: string[];
}

/** Renders both templates and validates the results (nothing is written). */
export function buildManifests(values: ManifestValues, dir = ADDINS_DIR): BuiltManifests {
  const officeTemplate = readFileSync(path.join(dir, "powerpoint/manifest.template.xml"), "utf8");
  const teamsTemplate = readFileSync(path.join(dir, "teams/manifest.template.json"), "utf8");
  // The template itself must be JSON before anything is filled in.
  JSON.parse(teamsTemplate);
  const powerpoint = renderTemplate(officeTemplate, values as unknown as Record<string, string>, escapeXml);
  const teams = JSON.parse(renderTemplate(teamsTemplate, values as unknown as Record<string, string>, escapeJsonString)) as Json;
  const errors = [
    ...validateOfficeManifest(powerpoint, values.APP_ORIGIN).map((e) => `powerpoint: ${e}`),
    ...validateTeamsManifest(teams, values.APP_ORIGIN).map((e) => `teams: ${e}`),
  ];
  return { values, powerpoint, teams, errors };
}

function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  const value = (key: string, env?: string) => (typeof args[key] === "string" ? (args[key] as string) : env ? process.env[env] : undefined);
  const origin = value("origin", "ADDIN_APP_ORIGIN");
  if (!origin) {
    console.error("Usage: bun addins/scripts/build-manifests.ts --origin https://your-site [--version 1.0.0] [--out addins/dist] [--dev]");
    process.exit(2);
  }
  const powerpointId = value("powerpoint-id", "POWERPOINT_ADDIN_ID");
  const teamsId = value("teams-id", "TEAMS_APP_ID");
  let values: ManifestValues;
  try {
    values = manifestValues({
      origin,
      version: value("version", "ADDIN_VERSION"),
      provider: value("provider", "ADDIN_PROVIDER_NAME"),
      support: value("support", "ADDIN_SUPPORT_URL"),
      powerpointId,
      teamsId,
      dev: args.dev === true,
    });
  } catch (error) {
    console.error(`[build-manifests] ${(error as Error).message}`);
    process.exit(2);
  }
  const built = buildManifests(values);
  if (built.errors.length) {
    console.error(`[build-manifests] ${built.errors.length} problem(s):\n  - ${built.errors.join("\n  - ")}`);
    process.exit(1);
  }
  const out = path.resolve(typeof args.out === "string" ? args.out : path.join(ADDINS_DIR, "dist"));
  mkdirSync(path.join(out, "powerpoint"), { recursive: true });
  mkdirSync(path.join(out, "teams"), { recursive: true });
  writeFileSync(path.join(out, "powerpoint/manifest.xml"), built.powerpoint);
  const manifestJson = new TextEncoder().encode(`${JSON.stringify(built.teams, null, 2)}\n`);
  const color = readFileSync(path.join(ADDINS_DIR, "teams/icons/color.png"));
  const outline = readFileSync(path.join(ADDINS_DIR, "teams/icons/outline.png"));
  writeFileSync(path.join(out, "teams/manifest.json"), manifestJson);
  writeFileSync(path.join(out, "teams/color.png"), color);
  writeFileSync(path.join(out, "teams/outline.png"), outline);
  writeFileSync(
    path.join(out, "teams/open-poll-teams.zip"),
    zipStore([
      { name: "manifest.json", data: manifestJson },
      { name: "color.png", data: new Uint8Array(color) },
      { name: "outline.png", data: new Uint8Array(outline) },
    ])
  );
  if (!powerpointId) console.warn(`[build-manifests] New POWERPOINT_ADDIN_ID ${values.POWERPOINT_ADDIN_ID}: keep it for every later build.`);
  if (!teamsId) console.warn(`[build-manifests] New TEAMS_APP_ID ${values.TEAMS_APP_ID}: keep it for every later build.`);
  console.log(`[build-manifests] ${values.APP_ORIGIN} v${values.VERSION} → ${out}/powerpoint/manifest.xml, ${out}/teams/open-poll-teams.zip`);
}
