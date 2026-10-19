"use client";

import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Loader2, Mail, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api-error";
import { ROLE_NAMES } from "../../types";
import { revokeInvite } from "../api/members.api";
import type { Invite } from "../types";

interface PendingInvitesProps {
  workspaceId: string;
  invites: Invite[];
  onChanged: () => void;
}

/** Unexpired invitations with a revoke button each. */
export function PendingInvites({ workspaceId, invites, onChanged }: PendingInvitesProps) {
  const [revoking, setRevoking] = useState<string | null>(null);

  const revoke = async (invite: Invite) => {
    setRevoking(invite.id);
    try {
      await revokeInvite(workspaceId, invite.id);
      toast.success(`Invitation for ${invite.email} revoked`);
      onChanged();
    } catch (error) {
      toast.error(getApiErrorMessage(error) ?? "Could not revoke the invitation");
    } finally {
      setRevoking(null);
    }
  };

  if (invites.length === 0) return <p className="text-sm text-muted-foreground">No pending invitations.</p>;

  return (
    <ul className="divide-y divide-border/60" aria-label="Pending invitations">
      {invites.map((invite) => (
        <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3" data-testid="pending-invite">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <Mail className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground/90">{invite.email}</p>
            <p className="text-xs text-muted-foreground">
              {ROLE_NAMES[invite.role]} · expires {formatDistanceToNowStrict(new Date(invite.expiresAt), { addSuffix: true })}
              {invite.invitedBy ? ` · invited by ${invite.invitedBy.name}` : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-xl text-muted-foreground hover:text-destructive"
            disabled={revoking === invite.id}
            onClick={() => void revoke(invite)}
            aria-label={`Revoke invitation for ${invite.email}`}
          >
            {revoking === invite.id ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}
