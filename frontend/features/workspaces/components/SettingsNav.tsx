"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCapabilities, useCurrentWorkspace, useSwitchWorkspace } from "../hooks/useWorkspaces";
import { SETTINGS_SECTIONS, TEAM_ONLY_REASON, resolveSection, type SettingsSection } from "../settings/sections";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

/** A section that does not open here: dashed chip on phones, muted row from lg. */
const lockedClass =
  "flex items-start gap-2.5 rounded-full border border-dashed border-border px-3.5 py-2 text-sm text-muted-foreground lg:w-full lg:rounded-lg lg:border-0 lg:px-2.5";

const GROUPS: { id: SettingsSection["group"]; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "workspace", label: "Workspace" },
];

/**
 * Settings navigation: every section from SETTINGS_SECTIONS. Sections the
 * deployment, plan, role or workspace type rules out stay listed, muted, with
 * a one-line reason, and still open: their page explains and offers the way
 * forward (switch workspace, create a team workspace, see plans). Sections
 * whose page has not shipped are disabled.
 *
 * Below lg it is one scrolling row of chips above the page (reasons go to
 * assistive tech only); from lg it is a column with the reasons visible. In a
 * personal workspace the first team-only section offers to create a team
 * workspace right there (lg).
 */
export function SettingsNav() {
  const pathname = usePathname();
  const capabilities = useCapabilities();
  const { detail } = useCurrentWorkspace();
  const { switchTo } = useSwitchWorkspace();
  const [creating, setCreating] = useState(false);
  const firstTeamOnly = SETTINGS_SECTIONS.find(
    (section) => resolveSection(section, { capabilities, workspace: detail }).reason === TEAM_ONLY_REASON,
  )?.id;

  return (
    <nav
      aria-label="Settings"
      className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:block lg:space-y-6 lg:overflow-visible lg:px-0"
    >
      {GROUPS.map((group) => (
        <div key={group.id} className="flex shrink-0 gap-2 lg:block lg:space-y-1">
          <p className="hidden px-2.5 pb-1 text-xs font-medium text-muted-foreground lg:block">
            {group.label}
            {group.id === "workspace" && detail ? (
              <span className="block truncate font-normal">{detail.workspace.name}</span>
            ) : null}
          </p>
          {SETTINGS_SECTIONS.filter((section) => section.group === group.id).map((section) => {
            const { available, reason } = resolveSection(section, { capabilities, workspace: detail });
            const active = pathname === section.href || pathname?.startsWith(`${section.href}/`);
            const Icon = section.icon;

            if (!available) {
              return (
                <div key={section.id} className="shrink-0 lg:w-full">
                  {section.ready && reason ? (
                    // Built but locked here: its page says why and how to get it (SectionUnavailable).
                    <Link
                      href={section.href}
                      title={reason}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        lockedClass,
                        "hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                        active && "border-solid bg-card text-foreground lg:border",
                      )}
                    >
                      <Icon className="mt-0.5 size-4 shrink-0 text-faint" />
                      <span className="min-w-0">
                        <span className="block whitespace-nowrap lg:whitespace-normal">{section.label}</span>
                        <span className="sr-only lg:not-sr-only lg:mt-0.5 lg:block lg:text-xs lg:leading-snug">{reason}</span>
                      </span>
                    </Link>
                  ) : (
                    <div aria-disabled="true" title={reason ?? undefined} className={cn(lockedClass, "cursor-not-allowed")}>
                      <Icon className="mt-0.5 size-4 shrink-0 text-faint" />
                      <span className="min-w-0">
                        <span className="block whitespace-nowrap lg:whitespace-normal">{section.label}</span>
                        {reason ? <span className="sr-only lg:not-sr-only lg:mt-0.5 lg:block lg:text-xs lg:leading-snug">{reason}</span> : null}
                      </span>
                    </div>
                  )}
                  {section.id === firstTeamOnly ? (
                    <button
                      type="button"
                      onClick={() => setCreating(true)}
                      className="mt-0.5 hidden items-center gap-1.5 rounded-md py-1 pl-9 pr-2 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring lg:flex"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      Create a team workspace
                    </button>
                  ) : null}
                </div>
              );
            }

            return (
              <Link
                key={section.id}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-colors duration-150 lg:w-full lg:rounded-lg lg:px-2.5",
                  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
                  active
                    ? "border-border bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.06)]"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground lg:border-transparent",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active && "text-accent-ink")} />
                {section.label}
              </Link>
            );
          })}
        </div>
      ))}
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreated={(created) => void switchTo(created.workspace._id)} />
    </nav>
  );
}
