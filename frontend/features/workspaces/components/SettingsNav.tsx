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
 */
export function SettingsNav() {
  const pathname = usePathname();
  const capabilities = useCapabilities();
  const { detail } = useCurrentWorkspace();

  return (
    <nav aria-label="Settings" className="space-y-6">
      {GROUPS.map((group) => (
        <div key={group.id} className="space-y-1">
          <p className="px-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            {group.label}
            {group.id === "workspace" && detail ? (
              <span className="mt-0.5 block truncate text-[11px] font-medium normal-case tracking-normal text-muted-foreground">
                {detail.workspace.name}
              </span>
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
                  className="flex w-full cursor-not-allowed items-start gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground/50"
                >
                  <Icon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block">{section.label}</span>
                    {reason ? <span className="block text-[11px] font-normal leading-snug">{reason}</span> : null}
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
                  "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all",
                  active
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {section.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
