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

const itemClass = "flex cursor-pointer items-center gap-2.5";

function WorkspaceTile({ workspace, className }: { workspace: Pick<WorkspaceSummary, "name"> | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-sm font-semibold uppercase text-background",
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
          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
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
        <span className="size-8 shrink-0 animate-pulse rounded-md bg-sidebar-accent" />
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
              "flex w-full items-center gap-2.5 rounded-xl border border-border bg-card p-2 text-left text-foreground transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
              collapsed && "w-auto justify-center border-transparent bg-transparent p-1 hover:border-transparent hover:bg-sidebar-accent",
            )}
          >
            <WorkspaceTile workspace={current} />
            {!collapsed && (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold leading-tight">{current.name}</span>
                  <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">
                    {current.type === "personal" ? "Personal, " : ""}{PLAN_NAMES[current.plan]} plan
                  </span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
              </>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={collapsed ? "right" : "bottom"}
          align="start"
          sideOffset={collapsed ? 12 : 4}
          className="w-64 p-1.5"
        >
          <DropdownMenuLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
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
                <WorkspaceTile workspace={workspace} className="size-7 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{workspace.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {workspace.type === "personal" ? "Personal" : ROLE_NAMES[workspace.role]}
                  </span>
                </span>
                {switchingTo === workspace._id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : isCurrent ? (
                  <Check className="size-4 text-accent-ink" aria-label="Current workspace" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
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
