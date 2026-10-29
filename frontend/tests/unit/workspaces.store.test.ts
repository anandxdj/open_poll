import { beforeEach, describe, expect, test } from "bun:test";

import {
  pathAfterSwitch,
  reconcileSelection,
  workspaceHeaderValue,
} from "@/features/workspaces/store/selection";
import type { WorkspaceDetail, WorkspaceList, WorkspaceSummary } from "@/features/workspaces/types";

// tests/setup/storage.ts (bunfig preload) provides localStorage before any module loads.
const { useWorkspaceStore } = await import("@/features/workspaces/store/useWorkspaceStore");

const summary = (id: string, fields: Partial<WorkspaceSummary> = {}): WorkspaceSummary => ({
  _id: id,
  name: `Workspace ${id}`,
  slug: `workspace-${id}`,
  type: "team",
  plan: "free",
  role: "owner",
  isDefault: false,
  ...fields,
});

const list = (defaultId: string, ...ids: string[]): WorkspaceList => ({
  defaultWorkspaceId: defaultId,
  workspaces: ids.map((id) => summary(id, { isDefault: id === defaultId })),
});

const detail = (id: string, fields: Partial<WorkspaceDetail["workspace"]> = {}): WorkspaceDetail => ({
  workspace: {
    _id: id,
    name: `Workspace ${id}`,
    slug: `workspace-${id}`,
    type: "team",
    plan: "free",
    ownerId: "u1",
    settings: { retentionDays: null, requireSso: false, allowedEmailDomains: [], embedAllowedOrigins: [], defaultTheme: null },
    createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    ...fields,
  },
  membership: { role: "admin", status: "active" },
  permissions: ["deck:read", "workspace:manage"],
  entitlements: {
    plan: "free",
    features: {
      export_csv: true,
      export_xlsx: false,
      export_pdf: false,
      brand_kits: false,
      sso: false,
      scim: false,
      custom_domains: false,
      white_label: false,
    },
    limits: { audienceCap: 100, seats: 1, retentionDays: 365, auditRetentionDays: 30, aiDecksPerMonth: 5, importsPerMonth: 5 },
  },
});

const store = () => useWorkspaceStore.getState();

describe("reconcileSelection", () => {
  test("keeps a selection that is still one of the user's workspaces", () => {
    expect(reconcileSelection("b", list("a", "a", "b"))).toBe("b");
  });

  test("falls back to the server default, then to the first workspace", () => {
    expect(reconcileSelection("gone", list("a", "a", "b"))).toBe("a");
    expect(reconcileSelection(null, list("b", "a", "b"))).toBe("b");
    expect(reconcileSelection(null, list("missing", "c", "d"))).toBe("c");
    expect(reconcileSelection("x", list("missing"))).toBeNull();
  });
});

describe("workspaceHeaderValue", () => {
  test("sends the selection only for the user who made it", () => {
    expect(workspaceHeaderValue({ userId: "u1", currentWorkspaceId: "w1" }, "u1")).toBe("w1");
    expect(workspaceHeaderValue({ userId: "u1", currentWorkspaceId: "w1" }, "u2")).toBeNull();
    expect(workspaceHeaderValue({ userId: "u1", currentWorkspaceId: "w1" }, null)).toBeNull();
    expect(workspaceHeaderValue({ userId: "u1", currentWorkspaceId: null }, "u1")).toBeNull();
  });
});

describe("pathAfterSwitch", () => {
  test("reloads settings pages in place and sends everything else to Home", () => {
    expect(pathAfterSwitch("/settings/workspace")).toBe("/settings/workspace");
    expect(pathAfterSwitch("/settings")).toBe("/settings");
    expect(pathAfterSwitch("/analytics/123")).toBe("/home");
    expect(pathAfterSwitch("/settingsx")).toBe("/home");
    expect(pathAfterSwitch(null)).toBe("/home");
  });
});

describe("useWorkspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ userId: null, currentWorkspaceId: null, workspaces: [], listStatus: "idle", current: null });
  });

  test("selects the server default on first load", () => {
    expect(store().beginListLoad("u1")).toBe(true);
    expect(store().listStatus).toBe("loading");
    store().setList("u1", list("a", "a", "b"));
    expect(store()).toMatchObject({ userId: "u1", currentWorkspaceId: "a", listStatus: "ready" });
    expect(store().workspaces.map((w) => w._id)).toEqual(["a", "b"]);
  });

  test("runs one list load at a time per user", () => {
    expect(store().beginListLoad("u1")).toBe(true);
    expect(store().beginListLoad("u1")).toBe(false);
  });

  test("keeps the selection across reloads while it stays valid", () => {
    useWorkspaceStore.setState({ userId: "u1", currentWorkspaceId: "b" });
    store().beginListLoad("u1");
    store().setList("u1", list("a", "a", "b"));
    expect(store().currentWorkspaceId).toBe("b");

    store().setList("u1", list("a", "a"));
    expect(store().currentWorkspaceId).toBe("a");
  });

  test("never carries another account's selection over", () => {
    useWorkspaceStore.setState({ userId: "u1", currentWorkspaceId: "shared", workspaces: [summary("shared")], current: detail("shared") });
    store().beginListLoad("u2");
    expect(store()).toMatchObject({ userId: "u2", currentWorkspaceId: null, workspaces: [], current: null });
    store().setList("u2", list("mine", "mine", "shared"));
    expect(store().currentWorkspaceId).toBe("mine");
  });

  test("select drops the detail of the previous workspace", () => {
    store().setList("u1", list("a", "a", "b"));
    store().setCurrent(detail("a"));
    store().select("b");
    expect(store()).toMatchObject({ currentWorkspaceId: "b", current: null });
  });

  test("setCurrent mirrors renames and plan changes into the list", () => {
    store().setList("u1", list("a", "a", "b"));
    store().setCurrent(detail("a", { name: "Renamed", plan: "team" }));
    expect(store().current?.workspace.name).toBe("Renamed");
    expect(store().workspaces[0]).toMatchObject({ _id: "a", name: "Renamed", plan: "team", role: "admin" });
    expect(store().workspaces[1].name).toBe("Workspace b");
  });

  test("clearSelection forgets a refused workspace and asks for a fresh list", () => {
    store().setList("u1", list("a", "a", "b"));
    store().select("b");
    store().clearSelection();
    expect(store()).toMatchObject({ currentWorkspaceId: null, current: null, listStatus: "idle", userId: "u1" });
  });

  test("persists only whose selection it is and which workspace", () => {
    store().setList("u1", list("a", "a"));
    store().setCurrent(detail("a"));
    expect(JSON.parse(localStorage.getItem("openpoll_workspace")!).state).toEqual({ userId: "u1", currentWorkspaceId: "a" });
  });
});
