"use client";

import { Folder, FolderPlus, MoreHorizontal, Pencil, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { folderItemCount, type LibraryFolder } from "../folders";
import type { LibraryFolderFilter } from "../types";

interface FolderBarProps {
  folders: LibraryFolder[];
  active: LibraryFolderFilter;
  onSelect: (folder: LibraryFolderFilter) => void;
  /** Editors and up: New folder, Rename, Delete. */
  canOrganize: boolean;
  /** Team workspaces, editors and up: Share folder. */
  canShare: boolean;
  onCreate: () => void;
  onRename: (folder: LibraryFolder) => void;
  onDelete: (folder: LibraryFolder) => void;
  onShare: (folder: LibraryFolder) => void;
}

const chip =
  "inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const chipIdle = "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground";
const chipActive = "border-foreground/30 bg-accent text-foreground";

/**
 * The library's folder filter: All items, Not in a folder, then one chip per
 * folder with its item count. The selected folder gets a menu (rename, share,
 * delete). The row scrolls sideways on narrow screens.
 */
export function FolderBar({ folders, active, onSelect, canOrganize, canShare, onCreate, onRename, onDelete, onShare }: FolderBarProps) {
  // Nothing to filter on yet: only the button to make the first folder.
  if (folders.length === 0 && active === "all") {
    return canOrganize ? (
      <div className="mt-6 flex items-center gap-3">
        <Button variant="outline" size="sm" className="bg-card" onClick={onCreate}>
          <FolderPlus /> New folder
        </Button>
        <p className="text-sm text-muted-foreground">Group decks and polls into folders.</p>
      </div>
    ) : null;
  }

  return (
    <div className="mt-6 flex items-center gap-2">
      <div role="group" aria-label="Folders" className="scrollbar-none -mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 py-1">
        <button type="button" aria-pressed={active === "all"} onClick={() => onSelect("all")} className={cn(chip, active === "all" ? chipActive : chipIdle)}>
          All items
        </button>
        <button type="button" aria-pressed={active === "root"} onClick={() => onSelect("root")} className={cn(chip, active === "root" ? chipActive : chipIdle)}>
          Not in a folder
        </button>
        {folders.map((folder) => {
          const selected = active === folder.id;
          const count = folderItemCount(folder);
          return (
            <div key={folder.id} className={cn("flex shrink-0 items-center rounded-lg", selected && (canOrganize || canShare) && "bg-accent")}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(folder.id)}
                className={cn(chip, selected ? chipActive : chipIdle, selected && (canOrganize || canShare) && "rounded-r-none border-r-0")}
              >
                <Folder className="size-3.5" aria-hidden="true" />
                <span className="max-w-[14rem] truncate">{folder.name}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {count}
                  <span className="sr-only"> item{count === 1 ? "" : "s"}</span>
                </span>
              </button>
              {selected && (canOrganize || canShare) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Folder actions for ${folder.name}`}
                      className={cn(chip, chipActive, "rounded-l-none border-l-0 px-2")}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-52 p-1.5">
                    {canOrganize ? (
                      <DropdownMenuItem onSelect={() => onRename(folder)}>
                        <Pencil /> Rename folder
                      </DropdownMenuItem>
                    ) : null}
                    {canShare ? (
                      <DropdownMenuItem onSelect={() => onShare(folder)}>
                        <Users /> Share folder…
                      </DropdownMenuItem>
                    ) : null}
                    {canOrganize ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(folder)}>
                          <Trash2 /> Delete folder
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          );
        })}
      </div>
      {canOrganize ? (
        <Button variant="outline" size="sm" className="shrink-0 bg-card" onClick={onCreate}>
          <FolderPlus /> <span className="hidden sm:inline">New folder</span>
          <span className="sr-only sm:hidden">New folder</span>
        </Button>
      ) : null}
    </div>
  );
}
