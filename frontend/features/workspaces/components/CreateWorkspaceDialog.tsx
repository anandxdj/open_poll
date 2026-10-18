"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api-error";
import { createWorkspace } from "../api/workspaces.api";
import type { WorkspaceDetail } from "../types";

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new workspace; the caller usually switches to it. */
  onCreated: (detail: WorkspaceDetail) => void;
}

/** Names and creates a team workspace (POST /api/workspaces). The plan gate's message is shown as is. */
export function CreateWorkspaceDialog({ open, onOpenChange, onCreated }: CreateWorkspaceDialogProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (submitting) return;
    if (!next) {
      setName("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const detail = await createWorkspace(trimmed);
      setName("");
      onOpenChange(false);
      onCreated(detail);
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not create the workspace");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md rounded-2xl sm:max-w-md">
        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Create a team workspace</DialogTitle>
            <DialogDescription>
              A shared space for your team&apos;s polls and decks. It starts on the Free plan, which has one seat;
              upgrade it to invite people.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Design"
              maxLength={120}
              autoFocus
              className="rounded-xl"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" className="rounded-xl" onClick={() => close(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl" disabled={submitting || !name.trim()}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : "Create workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
