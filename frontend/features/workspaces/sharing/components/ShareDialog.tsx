"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { getApiErrorMessage } from "@/lib/api-error";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { ROLE_NAMES } from "../../types";
import { listMembers } from "../../members/api/members.api";
import { RoleSelect, selectClass } from "../../members/components/RoleSelect";
import { ROLE_DESCRIPTIONS, SHARE_ROLES, type ShareRole } from "../../members/roles";
import type { Member } from "../../members/types";
import { getShares, putShares } from "../api/sharing.api";
import { addShare, candidatesFor, changeShareRole, isRedundant, removeShare, sameShares, toInputs } from "../shareModel";
import type { ShareEntry, ShareGroup, ShareResourceType } from "../types";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resourceType: ShareResourceType;
  resourceId: string;
  /** Shown in the heading until the server answers. */
  title: string;
}

const NOUN: Record<ShareResourceType, string> = { presentation: "deck", folder: "folder" };

interface Loaded {
  original: ShareEntry[];
  groups: ShareGroup[];
  members: Member[];
  resourceTitle: string;
}

function ShareDialogBody({ onOpenChange, resourceType, resourceId, title }: Omit<ShareDialogProps, "open">) {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const selfId = useAuthStore((state) => state.user?._id ?? null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [entries, setEntries] = useState<ShareEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pick, setPick] = useState("");
  const [pickRole, setPickRole] = useState<ShareRole>("viewer");
  const noun = NOUN[resourceType];

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    Promise.all([getShares(resourceType, resourceId), listMembers(workspaceId)]).then(
      ([shares, roster]) => {
        if (cancelled) return;
        setLoaded({ original: shares.shares, groups: shares.groups, members: roster.members, resourceTitle: shares.resource.title });
        setEntries(shares.shares);
      },
      (error: unknown) => {
        if (!cancelled) setLoadError(getApiErrorMessage(error) ?? `Couldn't load who this ${noun} is shared with`);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, resourceType, resourceId, noun]);

  const candidates = useMemo(
    () => (loaded ? candidatesFor(loaded.members, loaded.groups, entries, selfId) : []),
    [loaded, entries, selfId],
  );
  const dirty = loaded ? !sameShares(loaded.original, entries) : false;
  const people = candidates.filter((candidate) => candidate.principalType === "user");
  const groups = candidates.filter((candidate) => candidate.principalType === "group");

  const add = () => {
    const candidate = candidates.find((entry) => `${entry.principalType}:${entry.principalId}` === pick);
    if (!candidate) return;
    setEntries((current) => addShare(current, candidate, pickRole));
    setPick("");
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await putShares(resourceType, resourceId, toInputs(entries));
      toast.success(`Sharing updated for ${updated.resource.title}`);
      onOpenChange(false);
    } catch (error) {
      setSaveError(getApiErrorMessage(error) ?? "Couldn't save the sharing settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Share &ldquo;{loaded?.resourceTitle ?? title}&rdquo;</DialogTitle>
        <DialogDescription>
          Give workspace members access to this {noun} beyond their workspace role. Sharing never lowers anyone&apos;s access, and
          only members of this workspace can be added.
        </DialogDescription>
      </DialogHeader>

      {loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : !loaded ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <select
              aria-label="Member or group to share with"
              value={pick}
              onChange={(event) => setPick(event.target.value)}
              className={selectClass}
              disabled={candidates.length === 0}
            >
              <option value="">{candidates.length === 0 ? "Everyone already has access" : "Choose a member or group…"}</option>
              {people.length > 0 ? (
                <optgroup label="Members">
                  {people.map((candidate) => (
                    <option key={candidate.principalId} value={`user:${candidate.principalId}`}>
                      {candidate.name} ({candidate.email})
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {groups.length > 0 ? (
                <optgroup label="Groups">
                  {groups.map((candidate) => (
                    <option key={candidate.principalId} value={`group:${candidate.principalId}`}>
                      {candidate.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <RoleSelect
              value={pickRole}
              roles={SHARE_ROLES}
              label="Role to grant"
              onChange={(role) => setPickRole(role as ShareRole)}
              className="w-full sm:w-32"
            />
            <Button type="button" variant="outline" className="rounded-xl" disabled={!pick} onClick={add}>
              <UserPlus className="size-4" />
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[pickRole]}</p>

          {entries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Not shared with anyone yet. Members with an editor, admin or owner role already have access.
            </p>
          ) : (
            <ul className="divide-y divide-border/60" aria-label={`People and groups with access to this ${noun}`}>
              {entries.map((entry) => (
                <li key={`${entry.principalType}:${entry.principalId}`} className="flex flex-wrap items-center gap-3 py-2.5" data-testid="share-row">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
                  >
                    {entry.principalType === "group" ? <Users className="size-4" /> : (entry.name[0] ?? "?").toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground/90">
                      {entry.name}
                      {entry.principalType === "group" ? <span className="ml-2 text-xs text-muted-foreground">Group</span> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {entry.email ??
                        "Everyone in this group"}
                      {isRedundant(entry) && entry.workspaceRole ? ` · already ${ROLE_NAMES[entry.workspaceRole]} in this workspace` : ""}
                    </p>
                  </div>
                  <RoleSelect
                    value={entry.role}
                    roles={SHARE_ROLES}
                    label={`Access of ${entry.name}`}
                    onChange={(role) => setEntries((current) => changeShareRole(current, entry, role as ShareRole))}
                    className="w-32"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-xl text-muted-foreground hover:text-destructive"
                    aria-label={`Stop sharing with ${entry.name}`}
                    onClick={() => setEntries((current) => removeShare(current, entry))}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {saveError ? (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" className="rounded-xl" onClick={() => onOpenChange(false)} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" className="rounded-xl" disabled={!loaded || !dirty || saving} onClick={() => void save()}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Who a deck or folder is shared with (GET|PUT /api/shares). One entry point:
 * the "Share" item of the library card menu. The body mounts only while open,
 * so each opening starts from the server's current list.
 */
export function ShareDialog({ open, onOpenChange, ...resource }: ShareDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-2xl sm:max-w-xl">
        {open ? <ShareDialogBody onOpenChange={onOpenChange} {...resource} /> : null}
      </DialogContent>
    </Dialog>
  );
}
