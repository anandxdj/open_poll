/** API shapes of /api/me (backend `modules/privacy/privacy.service.ts`). */

export interface WorkspaceRef {
  workspaceId: string;
  name: string;
  type: "personal" | "team";
}

export interface ExportRecord {
  id: string;
  status: "delivered" | "failed";
  bytes: number;
  createdAt: string;
}

/** GET /api/me/privacy */
export interface PrivacyStatus {
  hasPassword: boolean;
  /** Until when deleting the account needs no new proof of identity; null when it needs one now. */
  reauthUntil: string | null;
  deletionGraceDays: number;
  /** Deleted with the account, and the team workspaces the user would leave. */
  workspaces: { deleted: WorkspaceRef[]; left: WorkspaceRef[] };
  blockers: {
    /** Team workspaces with other members where the user is the only owner. */
    soleOwner: WorkspaceRef[];
    /** Workspaces deleted with the account that still have a paid plan. */
    subscriptions: WorkspaceRef[];
  };
  exports: ExportRecord[];
  exportsLeftToday: number;
}

export const PRIVACY_ERROR_CODES = {
  reauthRequired: "REAUTH_REQUIRED",
  wrongPassword: "WRONG_PASSWORD",
  soleOwner: "SOLE_OWNER",
  activeSubscription: "ACTIVE_SUBSCRIPTION",
  exportLimit: "EXPORT_LIMIT",
} as const;
