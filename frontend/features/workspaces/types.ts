/**
 * Shapes of the workspaces API (backend/docs/wiki/modules/workspaces.md) and of
 * GET /api/capabilities (backend/docs/wiki/platform/plans.md).
 */

export type WorkspaceType = "personal" | "team";
export type PlanId = "free" | "pro" | "team" | "enterprise";
export type WorkspaceRole = "owner" | "admin" | "editor" | "presenter" | "viewer";

export type WorkspaceAction =
  | "deck:create"
  | "deck:read"
  | "deck:edit"
  | "deck:delete"
  | "deck:host"
  | "deck:share"
  | "deck:export"
  | "session:read"
  | "session:export"
  | "session:share"
  | "workspace:manage"
  | "workspace:billing"
  | "workspace:members"
  | "workspace:sso"
  | "workspace:domains"
  | "workspace:brand";

export type PlanFeature =
  | "export_csv"
  | "export_xlsx"
  | "export_pdf"
  | "brand_kits"
  | "sso"
  | "scim"
  | "custom_domains"
  | "white_label";

export type PlanLimit =
  | "audienceCap"
  | "seats"
  | "retentionDays"
  | "auditRetentionDays"
  | "aiDecksPerMonth"
  | "importsPerMonth";

export interface Entitlements {
  plan: PlanId;
  features: Record<PlanFeature, boolean>;
  /** null = unlimited. */
  limits: Record<PlanLimit, number | null>;
}

/** A row of GET /api/workspaces. */
export interface WorkspaceSummary {
  _id: string;
  name: string;
  slug: string;
  type: WorkspaceType;
  plan: PlanId;
  role: WorkspaceRole;
  isDefault: boolean;
}

export interface WorkspaceList {
  defaultWorkspaceId: string;
  workspaces: WorkspaceSummary[];
}

/** GET/PATCH /api/workspaces/:id, POST /api/workspaces, POST /api/workspaces/:id/switch. */
export interface WorkspaceDetail {
  workspace: {
    _id: string;
    name: string;
    slug: string;
    type: WorkspaceType;
    plan: PlanId;
    ownerId: string;
    settings: {
      retentionDays: number | null;
      requireSso: boolean;
      allowedEmailDomains: string[];
      embedAllowedOrigins: string[];
      defaultTheme: unknown;
    };
    createdAt: string;
    updatedAt: string;
  };
  membership: { role: WorkspaceRole; status: "active" | "invited" | "suspended" };
  /** Every action the member's role allows in this workspace. */
  permissions: WorkspaceAction[];
  entitlements: Entitlements;
}

export interface WorkspaceUpdate {
  name?: string;
  settings?: {
    retentionDays?: number | null;
    /** Sign-ins for verified SSO domains must use SSO (W3-D). */
    requireSso?: boolean;
    /** Theme new decks start with (W3-A); null = the built-in look. */
    defaultTheme?: { presetId: string; brandKitId: string | null } | null;
  };
}

/** What this deployment offers (GET /api/capabilities); separate from plan entitlements. */
export interface Capabilities {
  billing: boolean;
  storage: boolean;
  samlSso: boolean;
  scim: boolean;
  pptxHighFidelity: boolean;
  googleDriveImport: boolean;
  customDomains: boolean;
  metrics: boolean;
  ai: boolean;
}

export const PLAN_NAMES: Record<PlanId, string> = {
  free: "Free",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
};

export const ROLE_NAMES: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  presenter: "Presenter",
  viewer: "Viewer",
};
