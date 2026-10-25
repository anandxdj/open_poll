"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCapabilities, useCurrentWorkspace } from "../hooks/useWorkspaces";
import { SETTINGS_SECTIONS, resolveSection, type SettingsSection } from "../settings/sections";

const GROUPS: { id: SettingsSection["group"]; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "workspace", label: "Workspace" },
];

/**
 * Settings navigation: every section from SETTINGS_SECTIONS. Sections the
 * deployment, plan, role or workspace type rules out (or whose page has not
 * shipped) stay listed, disabled, with a one-line reason.
 *
 * Below lg it is one scrolling row of chips above the page (reasons go to
 * assistive tech only); from lg it is a column with the reasons visible.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const capabilities = useCapabilities();
  const { detail } = useCurrentWorkspace();

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
                <div
                  key={section.id}
                  aria-disabled="true"
                  title={reason ?? undefined}
                  className="flex shrink-0 cursor-not-allowed items-start gap-2.5 rounded-full border border-dashed border-border px-3.5 py-2 text-sm text-muted-foreground lg:w-full lg:rounded-lg lg:border-0 lg:px-2.5"
                >
                  <Icon className="mt-0.5 size-4 shrink-0 text-faint" />
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap lg:whitespace-normal">{section.label}</span>
                    {reason ? <span className="sr-only lg:not-sr-only lg:mt-0.5 lg:block lg:text-xs lg:leading-snug">{reason}</span> : null}
                  </span>
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
    </nav>
  );
}
