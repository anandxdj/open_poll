"use client";

import { useState } from "react";
import { Check, Folder, FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import {
  createFolder,
  deleteFolder,
  folderItemCount,
  MAX_FOLDER_NAME,
  moveToFolder,
  renameFolder,
  type LibraryFolder,
} from "../folders";
import type { LibraryCard } from "../types";

// The library's folder dialogs: name (create / rename), delete, and move an
// item to a folder. Each owns its request and reports the result upward.

interface FolderNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Rename this folder; create a new one when absent. */
  folder?: LibraryFolder | null;
  onSaved: (folder: LibraryFolder) => void;
}

export function FolderNameDialog({ open, onOpenChange, folder, onSaved }: FolderNameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Remounted per opening, so the field starts from the folder's current name. */}
        {open ? <FolderNameForm folder={folder ?? null} onDone={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function FolderNameForm({
  folder,
  onDone,
  onSaved,
}: {
  folder: LibraryFolder | null;
  onDone: () => void;
  onSaved: (folder: LibraryFolder) => void;
}) {
  const [name, setName] = useState(folder?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const renaming = folder !== null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the folder a name.");
      return;
    }
    if (renaming && trimmed === folder.name) {
      onDone();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = renaming ? await renameFolder(folder.id, trimmed) : await createFolder(trimmed);
      onSaved(saved);
      toast.success(renaming ? "Folder renamed." : `Folder “${saved.name}” created.`);
      onDone();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err) ?? (renaming ? "Couldn't rename the folder." : "Couldn't create the folder."));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{renaming ? "Rename folder" : "New folder"}</DialogTitle>
        <DialogDescription>
          {renaming ? "Everyone in the workspace sees the new name." : "Group decks and polls. Everyone in the workspace sees folders."}
        </DialogDescription>
      </DialogHeader>
      <div className="mt-5 space-y-2">
        <Label htmlFor="folder-name">Folder name</Label>
        <Input
          id="folder-name"
          value={name}
          autoFocus
          autoComplete="off"
          maxLength={MAX_FOLDER_NAME}
          placeholder="e.g. Q3 planning"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "folder-name-error" : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(null);
          }}
        />
        {error ? (
          <p id="folder-name-error" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          {renaming ? "Save name" : "Create folder"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface DeleteFolderDialogProps {
  folder: LibraryFolder | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (folder: LibraryFolder) => void;
}

export function DeleteFolderDialog({ folder, onOpenChange, onDeleted }: DeleteFolderDialogProps) {
  const [busy, setBusy] = useState(false);
  const count = folder ? folderItemCount(folder) : 0;

  async function confirm() {
    if (!folder) return;
    setBusy(true);
    try {
      await deleteFolder(folder.id);
      onDeleted(folder);
      toast.success(`Folder “${folder.name}” deleted.`);
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't delete the folder.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={folder !== null} onOpenChange={(open) => !busy && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete folder?</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>&quot;{folder?.name}&quot;</strong> is removed for everyone.{" "}
            {count > 0
              ? `Its ${count} item${count === 1 ? "" : "s"} stay in the library, outside any folder.`
              : "It is empty, so nothing else changes."}{" "}
            People it was shared with lose that access.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete folder
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface MoveToFolderDialogProps {
  card: LibraryCard | null;
  folders: LibraryFolder[];
  onOpenChange: (open: boolean) => void;
  /** The card now sits in `folderId` (null: outside any folder). */
  onMoved: (card: LibraryCard, folderId: string | null) => void;
}

/** Picks the folder for one library item: a radio list of folders plus "No folder". */
export function MoveToFolderDialog({ card, folders, onOpenChange, onMoved }: MoveToFolderDialogProps) {
  return (
    <Dialog open={card !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {card ? <MoveForm card={card} folders={folders} onDone={() => onOpenChange(false)} onMoved={onMoved} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function MoveForm({
  card,
  folders,
  onDone,
  onMoved,
}: {
  card: LibraryCard;
  folders: LibraryFolder[];
  onDone: () => void;
  onMoved: (card: LibraryCard, folderId: string | null) => void;
}) {
  const [target, setTarget] = useState<string | null>(card.folderId);
  const [saving, setSaving] = useState(false);
  const options: { id: string | null; name: string }[] = [{ id: null, name: "No folder" }, ...folders];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (target === card.folderId) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      await moveToFolder(target, [{ entityType: card.entityType, id: card.id }]);
      onMoved(card, target);
      const name = folders.find((folder) => folder.id === target)?.name;
      toast.success(name ? `Moved to “${name}”.` : "Moved out of the folder.");
      onDone();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't move this item.");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <DialogHeader>
        <DialogTitle>Move to folder</DialogTitle>
        <DialogDescription className="line-clamp-2">{card.title || "Untitled"}</DialogDescription>
      </DialogHeader>
      <fieldset className="mt-5">
        <legend className="sr-only">Folder</legend>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {options.map((option) => {
            const selected = option.id === target;
            const current = option.id === card.folderId;
            return (
              <label
                key={option.id ?? "root"}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                  selected ? "border-foreground/30 bg-accent" : "border-transparent hover:bg-accent/60",
                )}
              >
                <input
                  type="radio"
                  name="move-target"
                  className="sr-only"
                  checked={selected}
                  onChange={() => setTarget(option.id)}
                />
                {option.id === null ? (
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{option.name}</span>
                {current ? <span className="text-xs text-muted-foreground">Current</span> : null}
                {selected ? <Check className="size-4 shrink-0 text-accent-ink" aria-hidden="true" /> : null}
              </label>
            );
          })}
        </div>
        {folders.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No folders yet. Create one with New folder in the library.</p>
        ) : null}
      </fieldset>
      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || target === card.folderId}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Move
        </Button>
      </DialogFooter>
    </form>
  );
}
