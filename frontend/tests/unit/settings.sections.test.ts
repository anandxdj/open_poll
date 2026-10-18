import { describe, expect, test } from "bun:test";

import { SETTINGS_SECTIONS, resolveSection, type SettingsSection } from "@/features/workspaces/settings/sections";
import type { Capabilities, PlanFeature, WorkspaceAction, WorkspaceDetail } from "@/features/workspaces/types";

const capabilities = (on: Partial<Capabilities> = {}): Capabilities => ({
  billing: false,
  storage: false,
  samlSso: false,
  scim: false,
  pptxHighFidelity: false,
  googleDriveImport: false,
  customDomains: false,
  metrics: false,
  ai: false,
  ...on,
});

const ALL_ACTIONS: WorkspaceAction[] = [
  "deck:create",
  "deck:read",
  "deck:edit",
  "deck:delete",
  "deck:host",
  "deck:share",
  "deck:export",
  "session:read",
  "session:export",
  "session:share",
  "workspace:manage",
  "workspace:billing",
  "workspace:members",
  "workspace:sso",
  "workspace:domains",
  "workspace:brand",
];

function workspace({
  type = "team",
  plan = "enterprise",
  features = {},
  permissions = ALL_ACTIONS,
}: {
  type?: "personal" | "team";
  plan?: WorkspaceDetail["entitlements"]["plan"];
  features?: Partial<Record<PlanFeature, boolean>>;
  permissions?: WorkspaceAction[];
} = {}): WorkspaceDetail {
  return {
    workspace: {
      _id: "w1",
      name: "Acme",
      slug: "acme-123abc",
      type,
      plan,
      ownerId: "u1",
      settings: { retentionDays: null, requireSso: false, allowedEmailDomains: [], embedAllowedOrigins: [], defaultTheme: null },
      createdAt: "2026-10-19T00:00:00.000Z",
      updatedAt: "2026-10-19T00:00:00.000Z",
    },
    membership: { role: "owner", status: "active" },
    permissions,
    entitlements: {
      plan,
      features: {
        export_csv: true,
        export_xlsx: true,
        export_pdf: true,
        brand_kits: true,
        sso: true,
        scim: true,
        custom_domains: true,
        white_label: true,
        ...features,
      },
      limits: { audienceCap: 10_000, seats: null, retentionDays: null, auditRetentionDays: 730, aiDecksPerMonth: null, importsPerMonth: null },
    },
  };
}

const section = (id: SettingsSection["id"]) => SETTINGS_SECTIONS.find((candidate) => candidate.id === id)!;
const everything = capabilities({ billing: true, samlSso: true, scim: true, customDomains: true });

describe("SETTINGS_SECTIONS", () => {
  test("lists every planned section once, each at /settings/<id>", () => {
    expect(SETTINGS_SECTIONS.map((s): string => s.id).sort()).toEqual(
      ["audit", "billing", "brand", "domains", "mcp", "members", "privacy", "profile", "scim", "sso", "workspace"].sort(),
    );
    for (const s of SETTINGS_SECTIONS) expect(s.href).toBe(`/settings/${s.id}`);
  });

  test("ships the profile, MCP and workspace pages", () => {
    expect(SETTINGS_SECTIONS.filter((s) => s.ready).map((s) => s.id)).toEqual(["profile", "mcp", "workspace"]);
  });
});

describe("resolveSection", () => {
  test("ungated sections are available before anything loads", () => {
    for (const id of ["profile", "mcp", "workspace"] as const) {
      expect(resolveSection(section(id), { capabilities: null, workspace: null })).toEqual({ available: true, reason: null });
    }
  });

  test("gated sections wait, without a reason, until their data loads", () => {
    expect(resolveSection(section("billing"), { capabilities: null, workspace: null })).toEqual({ available: false, reason: null });
    expect(resolveSection(section("brand"), { capabilities: everything, workspace: null })).toEqual({ available: false, reason: null });
  });

  test("explains a capability this server lacks first", () => {
    const result = resolveSection(section("sso"), { capabilities: capabilities(), workspace: workspace({ type: "personal", plan: "free" }) });
    expect(result).toEqual({ available: false, reason: "Single sign-on isn't enabled on this server." });
    expect(resolveSection(section("billing"), { capabilities: capabilities(), workspace: workspace() }).reason).toMatch(/Billing isn't set up/);
  });

  test("then team-only sections in a personal workspace", () => {
    const result = resolveSection(section("members"), { capabilities: everything, workspace: workspace({ type: "personal" }) });
    expect(result.reason).toMatch(/Only team workspaces/);
  });

  test("then plan features, naming the plan", () => {
    const result = resolveSection(section("brand"), {
      capabilities: everything,
      workspace: workspace({ plan: "free", features: { brand_kits: false } }),
    });
    expect(result).toEqual({ available: false, reason: "Not included in the Free plan." });
  });

  test("then the member's role", () => {
    const editor = workspace({ permissions: ["deck:create", "deck:read", "deck:edit"] });
    expect(resolveSection(section("billing"), { capabilities: everything, workspace: editor }).reason).toBe("Requires the Owner role.");
    expect(resolveSection(section("domains"), { capabilities: everything, workspace: editor }).reason).toBe("Requires the Admin role.");
  });

  test("and last whether the page has shipped", () => {
    for (const id of ["members", "brand", "billing", "sso", "scim", "domains", "audit"] as const) {
      expect(resolveSection(section(id), { capabilities: everything, workspace: workspace() })).toEqual({
        available: false,
        reason: "Coming soon.",
      });
    }
    expect(resolveSection(section("privacy"), { capabilities: null, workspace: null }).reason).toBe("Coming soon.");
  });

  test("a shipped section with every gate passing is available", () => {
    const shipped = { ...section("billing"), ready: true };
    expect(resolveSection(shipped, { capabilities: everything, workspace: workspace() })).toEqual({ available: true, reason: null });
  });
});
