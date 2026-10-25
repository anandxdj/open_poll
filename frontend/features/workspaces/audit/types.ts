export type AuditActorType = "user" | "scim" | "system" | "api";

export interface AuditEvent {
  id: string;
  action: string;
  actorType: AuditActorType;
  actor: { id: string; name: string; email: string } | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  ua: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditPage {
  events: AuditEvent[];
  nextCursor: string | null;
  /** Every action the workspace recorded; first page only. */
  actions: string[];
}

export interface AuditFilters {
  /** Exact action, or a prefix ending in `*`. */
  action?: string;
  actor?: string;
  cursor?: string;
  limit?: number;
}
