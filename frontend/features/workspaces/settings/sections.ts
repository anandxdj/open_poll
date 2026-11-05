import {
  Building2,
  CreditCard,
  Globe,
  KeyRound,
  Palette,
  Plug,
  ScrollText,
  ShieldCheck,
  User,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  PLAN_NAMES,
  ROLE_NAMES,
  type Capabilities,
  type PlanFeature,
  type WorkspaceAction,
  type WorkspaceDetail,
  type WorkspaceRole,
} from "../types";

export type SettingsSectionId =
  | "profile"
  | "mcp"
  | "privacy"
  | "workspace"
  | "members"
  | "brand"
  | "billing"
  | "sso"
  | "scim"
  | "domains"
  | "audit";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  /** Always `/settings/<id>`; the page is `app/(dashboard)/settings/<id>/page.tsx`. */
  href: string;
  icon: LucideIcon;
  group: "account" | "workspace";
  /** The page exists. The package that ships it flips this to true (one-line change). */
  ready: boolean;
  /** Deployment capability required (GET /api/capabilities), with the line shown when it is off. */
  capability?: { key: keyof Capabilities; reason: string };
  /** Only team workspaces have this section. */
  teamOnly?: boolean;
  /** Plan feature required (entitlements of the current workspace). */
  feature?: PlanFeature;
  /** Action the member's role must allow, and the lowest role that does (for the reason line). */
  action?: { name: WorkspaceAction; minimumRole: WorkspaceRole };
}

/**
 * Every settings section, in nav order. Gates are checked in this order:
 * capability → team-only → plan feature → role → page ready. The first one
 * that fails disables the entry and gives its one-line reason.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: "profile", label: "Profile", href: "/settings/profile", icon: User, group: "account", ready: true },
  { id: "mcp", label: "MCP", href: "/settings/mcp", icon: Plug, group: "account", ready: true },
  { id: "privacy", label: "Privacy", href: "/settings/privacy", icon: ShieldCheck, group: "account", ready: true },
  { id: "workspace", label: "Workspace", href: "/settings/workspace", icon: Building2, group: "workspace", ready: true },
  { id: "members", label: "Members", href: "/settings/members", icon: Users, group: "workspace", ready: true, teamOnly: true },
  {
    id: "brand",
    label: "Brand",
    href: "/settings/brand",
    icon: Palette,
    group: "workspace",
    ready: false,
    feature: "brand_kits",
    action: { name: "workspace:brand", minimumRole: "admin" },
  },
  {
    id: "billing",
    label: "Billing",
    href: "/settings/billing",
    icon: CreditCard,
    group: "workspace",
    ready: true,
    // No capability gate: without Stripe the page still shows the plan and usage, and says billing is off.
    action: { name: "workspace:billing", minimumRole: "owner" },
  },
  {
    id: "sso",
    label: "Single sign-on",
    href: "/settings/sso",
    icon: KeyRound,
    group: "workspace",
    ready: false,
    capability: { key: "samlSso", reason: "Single sign-on isn't enabled on this server." },
    teamOnly: true,
    feature: "sso",
    action: { name: "workspace:sso", minimumRole: "admin" },
  },
  {
    id: "scim",
    label: "SCIM provisioning",
    href: "/settings/scim",
    icon: UserCog,
    group: "workspace",
    ready: false,
    capability: { key: "scim", reason: "SCIM provisioning isn't enabled on this server." },
    teamOnly: true,
    feature: "scim",
    action: { name: "workspace:sso", minimumRole: "admin" },
  },
  {
    id: "domains",
    label: "Custom domains",
    href: "/settings/domains",
    icon: Globe,
    group: "workspace",
    ready: false,
    capability: { key: "customDomains", reason: "Custom domains aren't enabled on this server." },
    feature: "custom_domains",
    action: { name: "workspace:domains", minimumRole: "admin" },
  },
  {
    id: "audit",
    label: "Audit log",
    href: "/settings/audit",
    icon: ScrollText,
    group: "workspace",
    ready: true,
    action: { name: "workspace:manage", minimumRole: "admin" },
  },
];

export const SETTINGS_HOME = "/settings/profile";

/** Reason line of a team-only section in a personal workspace; the nav adds a "Create a team workspace" button under it. */
export const TEAM_ONLY_REASON = "Only team workspaces have this.";

export interface SectionGateInput {
  /** null while GET /api/capabilities is loading. */
  capabilities: Capabilities | null;
  /** The current workspace's detail; null while loading. */
  workspace: WorkspaceDetail | null;
}

/** `reason` is null while the data a gate needs is still loading. */
export type SectionAvailability = { available: true; reason: null } | { available: false; reason: string | null };

const PENDING: SectionAvailability = { available: false, reason: null };

export function resolveSection(section: SettingsSection, { capabilities, workspace }: SectionGateInput): SectionAvailability {
  if (section.capability) {
    if (!capabilities) return PENDING;
    if (!capabilities[section.capability.key]) return { available: false, reason: section.capability.reason };
  }
  if (section.teamOnly || section.feature || section.action) {
    if (!workspace) return PENDING;
    if (section.teamOnly && workspace.workspace.type !== "team") {
      return { available: false, reason: TEAM_ONLY_REASON };
    }
    if (section.feature && !workspace.entitlements.features[section.feature]) {
      return { available: false, reason: `Not included in the ${PLAN_NAMES[workspace.entitlements.plan]} plan.` };
    }
    if (section.action && !workspace.permissions.includes(section.action.name)) {
      return { available: false, reason: `Requires the ${ROLE_NAMES[section.action.minimumRole]} role.` };
    }
  }
  if (!section.ready) return { available: false, reason: "Coming soon." };
  return { available: true, reason: null };
}
