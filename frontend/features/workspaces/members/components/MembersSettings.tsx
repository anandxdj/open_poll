"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/features/auth/store/useAuthStore";
import { getApiErrorMessage } from "@/lib/api-error";
import { SettingsHeading, settingsCard } from "../../settings/blocks";
import { useCurrentWorkspace } from "../../hooks/useWorkspaces";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { PLAN_NAMES, ROLE_NAMES, type WorkspaceDetail, type WorkspaceRole } from "../../types";
import { listInvites, listMembers, removeMember, transferOwnership, updateMember } from "../api/members.api";
import { describeSeats, hasFreeSeat } from "../roles";
import type { Invite, Member, MemberList } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { InviteForm } from "./InviteForm";
import { MemberRow, type MemberAction } from "./MemberRow";
import { PendingInvites } from "./PendingInvites";
import { SectionUnavailable } from "../../settings/SectionUnavailable";



interface Loaded {
  list: MemberList;
  invites: Invite[];
}

async function loadAll(workspaceId: string): Promise<Loaded> {
  const list = await listMembers(workspaceId);
  const invites = list.canManage ? await listInvites(workspaceId) : [];
  return { list, invites };
}

interface PendingConfirm {
  member: Member;
  action: Exclude<MemberAction, "reactivate">;
}

function confirmCopy({ member, action }: PendingConfirm, workspaceName: string) {
  switch (action) {
    case "remove":
      return {
        title: `Remove ${member.name}?`,
        description: `${member.name} loses access to ${workspaceName}, including anything shared with them. Their own decks stay in the workspace.`,
        confirm: "Remove member",
        destructive: true,
      };
    case "leave":
      return {
        title: `Leave ${workspaceName}?`,
        description: "You lose access to this workspace's decks and polls. An admin can invite you again.",
        confirm: "Leave workspace",
        destructive: true,
      };
    case "suspend":
      return {
        title: `Suspend ${member.name}?`,
        description: `${member.name} can't open ${workspaceName} until you reactivate them. A suspended member doesn't use a seat, and reactivating needs a free one.`,
        confirm: "Suspend",
        destructive: true,
      };
    default:
      return {
        title: `Make ${member.name} the primary owner?`,
        description: `${member.name} becomes an owner and the billing contact of ${workspaceName}. You stay an owner and can step down afterwards.`,
        confirm: "Transfer ownership",
        destructive: false,
      };
  }
}

function MembersPanel({ detail }: { detail: WorkspaceDetail }) {
  const workspaceId = detail.workspace._id;
  const myRole = detail.membership.role;
  const selfId = useAuthStore((state) => state.user?._id ?? null);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    loadAll(workspaceId).then(
      (loaded) => {
        if (cancelled) return;
        setData(loaded);
        setError(null);
      },
      (err: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(err) ?? "Couldn't load the members");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version]);

  /** Runs one change, reloads either way (the roster may have moved on), and says whether it worked. */
  const run = async (member: Member, work: () => Promise<unknown>, success: string): Promise<boolean> => {
    setBusyId(member.userId);
    try {
      await work();
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? "That didn't work");
      return false;
    } finally {
      setBusyId(null);
      reload();
    }
  };

  const changeRole = (member: Member, role: WorkspaceRole) =>
    run(member, () => updateMember(workspaceId, member.userId, { role }), `${member.name} is now ${ROLE_NAMES[role]}`);

  const onAction = (member: Member, action: MemberAction) => {
    if (action === "reactivate") {
      void run(member, () => updateMember(workspaceId, member.userId, { status: "active" }), `${member.name} reactivated`);
    } else {
      setPending({ member, action });
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const { member, action } = pending;
    if (action === "remove") await run(member, () => removeMember(workspaceId, member.userId), `${member.name} removed`);
    else if (action === "suspend") await run(member, () => updateMember(workspaceId, member.userId, { status: "suspended" }), `${member.name} suspended`);
    else if (action === "transfer") await run(member, () => transferOwnership(workspaceId, member.userId), `${member.name} is the primary owner now`);
    else if (await run(member, () => removeMember(workspaceId, member.userId), "You left the workspace")) {
      // The selection is gone with the membership: reload from the default workspace.
      useWorkspaceStore.getState().clearSelection();
      window.location.assign("/home");
    }
    setPending(null);
  };

  if (error && !data) {
    return (
      <div className={`${settingsCard} space-y-3`}>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading members…
      </div>
    );
  }

  const { list, invites } = data;
  const isPrimaryOwner = list.members.some((member) => member.isPrimaryOwner && member.userId === selfId);
  const copy = pending ? confirmCopy(pending, detail.workspace.name) : null;

  return (
    <div className="space-y-12">
      <section className="space-y-6">
        <SettingsHeading
          title="Members"
          description={`${describeSeats(list.seats)} on the ${PLAN_NAMES[detail.entitlements.plan]} plan.`}
        />
        {list.canManage ? (
          <div className={settingsCard}>
            <InviteForm workspaceId={workspaceId} myRole={myRole} full={!hasFreeSeat(list.seats)} onInvited={reload} />
          </div>
        ) : null}
        <div className={settingsCard}>
          <ul className="divide-y divide-border/60" aria-label="Workspace members">
            {list.members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                selfId={selfId}
                myRole={myRole}
                canManage={list.canManage}
                isPrimaryOwner={isPrimaryOwner}
                busy={busyId === member.userId}
                onRoleChange={(target, role) => void changeRole(target, role)}
                onAction={onAction}
              />
            ))}
          </ul>
          {!list.canManage ? (
            <p className="mt-4 text-xs text-muted-foreground">Only owners and admins can change roles and invite people.</p>
          ) : null}
        </div>
      </section>

      {list.canManage ? (
        <section className="space-y-6">
          <SettingsHeading title="Pending invitations" description="An invitation holds a seat until it is accepted, revoked or expires." />
          <div className={settingsCard}>
            <PendingInvites workspaceId={workspaceId} invites={invites} onChanged={reload} />
          </div>
        </section>
      ) : null}

      {copy ? (
        <ConfirmDialog
          open
          title={copy.title}
          description={copy.description}
          confirmLabel={copy.confirm}
          destructive={copy.destructive}
          busy={busyId !== null}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}

/** Content of /settings/members: the roster, invitations and role management. */
export function MembersSettings() {
  const { detail, failed, retry } = useCurrentWorkspace();

  if (failed) {
    return (
      <div className={`${settingsCard} space-y-3`}>
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this workspace.</p>
        <Button variant="outline" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading workspace…
      </div>
    );
  }
  if (detail.workspace.type !== "team") {
    return <SectionUnavailable id="members" title="Members" description="Personal workspaces have only you. Work with others in a team workspace." />;
  }
  // Keyed so switching workspace starts from a clean state.
  return <MembersPanel key={detail.workspace._id} detail={detail} />;
}
