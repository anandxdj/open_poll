"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Loader2, Plus, RotateCw, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSwitchWorkspace, useWorkspaces } from "../hooks/useWorkspaces";
import { PLAN_NAMES, ROLE_NAMES, type WorkspaceSummary } from "../types";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";

const itemClass =
  "flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-sidebar-foreground/70 transition-colors focus:bg-primary/10 focus:text-primary";

function WorkspaceTile({ workspace, className }: { workspace: Pick<WorkspaceSummary, "name"> | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/15 text-[11px] font-bold uppercase text-primary",
        className,
      )}
    >
      {workspace?.name.trim().charAt(0) || "·"}
    </span>
  );
}

/** Sidebar header control: shows the current workspace, switches between workspaces, creates team ones. */
export function WorkspaceSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { workspaces, current, status, reload } = useWorkspaces();
  const { switchTo, switchingTo } = useSwitchWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  if (status === "error") {
    return (
      <button
        type="button"
        onClick={reload}
        title="Couldn't load workspaces. Retry"
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-[11px] text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
          collapsed && "w-9 justify-center px-0",
        )}
      >
        <RotateCw className="size-3.5 shrink-0" />
        {!collapsed && <span className="truncate">Couldn&apos;t load workspaces</span>}
      </button>
    );
  }

  if (!current) {
    return (
      <div
        aria-busy
        aria-label="Loading workspaces"
        className={cn("flex w-full items-center gap-2 px-2 py-1.5", collapsed && "w-9 justify-center px-0")}
      >
        <span className="size-7 shrink-0 animate-pulse rounded-lg bg-sidebar-accent" />
        {!collapsed && <span className="h-3 flex-1 animate-pulse rounded bg-sidebar-accent" />}
      </div>
    );
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Workspace: ${current.name}. Switch workspace`}
            title={collapsed ? current.name : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              collapsed && "w-9 justify-center px-0",
            )}
          >
            <WorkspaceTile workspace={current} />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold leading-none">{current.name}</span>
                  <span className="mt-1 block truncate text-[9px] leading-none text-sidebar-foreground/40">
                    {current.type === "personal" ? "Personal" : "Team"} · {PLAN_NAMES[current.plan]}
                  </span>
                </span>
                <ChevronsUpDown className="size-3 shrink-0 opacity-40" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={collapsed ? "right" : "bottom"}
          align="start"
          sideOffset={collapsed ? 12 : 4}
          className="w-60 rounded-2xl border-sidebar-border bg-sidebar p-1 shadow-2xl"
        >
          <DropdownMenuLabel className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/40">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((workspace) => {
            const isCurrent = workspace._id === current._id;
            return (
              <DropdownMenuItem
                key={workspace._id}
                disabled={switchingTo !== null}
                onSelect={() => {
                  if (!isCurrent) void switchTo(workspace._id);
                }}
                className={itemClass}
              >
                <WorkspaceTile workspace={workspace} className="size-6 text-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{workspace.name}</span>
                  <span className="block text-[10px] text-sidebar-foreground/40">
                    {workspace.type === "personal" ? "Personal" : ROLE_NAMES[workspace.role]}
                  </span>
                </span>
                {switchingTo === workspace._id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : isCurrent ? (
                  <Check className="size-3.5 text-primary" aria-label="Current workspace" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator className="my-1 bg-sidebar-border" />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)} className={itemClass}>
            <Plus className="size-4" />
            Create team workspace
          </DropdownMenuItem>
          <DropdownMenuItem asChild className={itemClass}>
            <Link href="/settings/workspace">
              <Settings className="size-4" />
              Workspace settings
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(detail) => void switchTo(detail.workspace._id)}
      />
    </>
  );
}
