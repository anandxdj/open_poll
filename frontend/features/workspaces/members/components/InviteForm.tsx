"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiErrorMessage } from "@/lib/api-error";
import type { WorkspaceRole } from "../../types";
import { createInvite } from "../api/members.api";
import { ROLE_DESCRIPTIONS, invitableRoles } from "../roles";
import type { CreatedInvite, InviteRole } from "../types";
import { RoleSelect } from "./RoleSelect";

interface InviteFormProps {
  workspaceId: string;
  /** The inviter's role: they may invite up to it. */
  myRole: WorkspaceRole;
  /** No seat left for another invitation. */
  full: boolean;
  onInvited: () => void;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Invitation link copied");
  } catch {
    toast.error("Couldn't copy to the clipboard");
  }
}

/** Email + role form for POST /invites, then the link for sharing by hand. */
export function InviteForm({ workspaceId, myRole, full, onInvited }: InviteFormProps) {
  const roles = invitableRoles(myRole);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>(roles.includes("editor") ? "editor" : (roles.at(-1) ?? "viewer"));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<CreatedInvite | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      const result = await createInvite(workspaceId, { email: trimmed, role });
      setSent(result);
      setEmail("");
      onInvited();
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Could not send the invitation");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={(event) => void submit(event)} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="invite-email">Invite by email</Label>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            placeholder="teammate@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            disabled={sending || full}
            className="rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="invite-role">Role</Label>
          <RoleSelect
            value={role}
            roles={roles}
            label="Role of the invited person"
            onChange={(next) => setRole(next as InviteRole)}
            disabled={sending || full}
            className="w-full sm:w-36"
          />
        </div>
        <Button type="submit" className="rounded-xl" disabled={sending || full || !email.trim()}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Send invite
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
      {full ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Every seat is taken or reserved by a pending invitation. Revoke an invitation or upgrade the plan to invite more people.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {sent ? (
        <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-4" data-testid="invite-result">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground/90">
            <Check className="size-4 text-primary" />
            {sent.refreshed ? "Invitation refreshed for " : "Invitation created for "}
            {sent.invite.email}
          </p>
          <p className="text-xs text-muted-foreground">
            {sent.emailSent
              ? "We emailed them the link. You can also share it yourself; it works once, for that address only."
              : "Email isn't set up on this server, so nothing was sent. Share this link yourself; it works once, for that address only."}
          </p>
          <div className="flex gap-2">
            <Input readOnly value={sent.inviteUrl} aria-label="Invitation link" className="rounded-xl font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
            <Button type="button" variant="outline" className="shrink-0 rounded-xl" onClick={() => void copy(sent.inviteUrl)}>
              <Copy className="size-4" />
              Copy
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
