"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { readBlobError } from "@/features/sessions/api/sessions";
import {
  SettingsFailed,
  SettingsHeading,
  SettingsLoading,
  SettingsRow,
  settingsCard,
  settingsList,
} from "@/features/workspaces/settings/blocks";
import { cn } from "@/lib/utils";
import { downloadMyData } from "../api/privacy.api";
import { formatBytes, formatLongDate, listNames } from "../format";
import { usePrivacyStatus } from "../hooks/usePrivacyStatus";
import type { PrivacyStatus } from "../types";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

const outlineLink = cn(buttonVariants({ variant: "outline" }), "bg-card");

function exportSummary(status: PrivacyStatus): string {
  const last = status.exports.find((job) => job.status === "delivered");
  const left =
    status.exportsLeftToday === 0
      ? "You can download it again tomorrow."
      : `${status.exportsLeftToday} of 3 downloads left today.`;
  return last ? `Last downloaded ${formatLongDate(last.createdAt)} (${formatBytes(last.bytes)}). ${left}` : left;
}

function DataSection({ status, onExported }: { status: PrivacyStatus; onExported: () => void }) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      await downloadMyData(`openpoll-data-${new Date().toISOString().slice(0, 10)}.zip`);
      toast.success("Your data is downloading.");
    } catch (err) {
      toast.error((await readBlobError(err))?.message ?? "Your data could not be prepared. Try again.");
    } finally {
      setBusy(false);
      onExported();
    }
  }

  return (
    <section id="data" aria-labelledby="data-title" className="scroll-mt-20 space-y-5">
      <SettingsHeading id="data-title" title="Your data" description="What Open Poll keeps about you, and a copy to take with you." />
      <div className={settingsList}>
        <SettingsRow
          label="Download your data"
          description={
            <>
              A zip of JSON files: your profile, workspaces, polls, decks, the sessions you ran and your activity.
              <span className="mt-1 block">{exportSummary(status)}</span>
            </>
          }
        >
          <Button variant="outline" className="bg-card" onClick={() => void download()} disabled={busy || status.exportsLeftToday === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
            {busy ? "Preparing…" : "Download"}
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Session results"
          description="Each workspace decides how long it keeps the results of its sessions. Admins change it in the workspace settings."
        >
          <Link href="/settings/workspace#retention" className={outlineLink}>
            Workspace settings
          </Link>
        </SettingsRow>
        <SettingsRow label="Privacy policy" description="What we collect, why, and who we share it with.">
          <Link href="/privacy" className={outlineLink}>
            Read the policy
          </Link>
        </SettingsRow>
      </div>
    </section>
  );
}

function Blockers({ status }: { status: PrivacyStatus }) {
  const { soleOwner, subscriptions } = status.blockers;
  if (!soleOwner.length && !subscriptions.length) return null;
  return (
    <div role="note" className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
      <p className="font-medium">Before you can delete your account</p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {soleOwner.length ? (
          <li>
            You&apos;re the only owner of {listNames(soleOwner)}. Switch to {soleOwner.length > 1 ? "each one" : "it"} and make
            someone else an owner in{" "}
            <Link href="/settings/members" className="font-medium text-foreground underline underline-offset-4">
              Members
            </Link>
            .
          </li>
        ) : null}
        {subscriptions.length ? (
          <li>
            {listNames(subscriptions)} {subscriptions.length > 1 ? "have" : "has"} a paid plan. Cancel it in{" "}
            <Link href="/settings/billing" className="font-medium text-foreground underline underline-offset-4">
              Billing
            </Link>{" "}
            first.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function DeleteSection({ status, onRefused }: { status: PrivacyStatus; onRefused: () => void }) {
  // A new key per opening remounts the dialog, so it reads the time and the password afresh.
  const [opening, setOpening] = useState(0);
  const [open, setOpen] = useState(false);
  const blocked = status.blockers.soleOwner.length > 0 || status.blockers.subscriptions.length > 0;

  return (
    <section id="delete" aria-labelledby="delete-title" className="scroll-mt-20 space-y-5">
      <SettingsHeading
        id="delete-title"
        title="Delete account"
        description={`We delete your account ${status.deletionGraceDays} days after you ask. Log in before then to keep it.`}
      />
      <div className={cn(settingsCard, "space-y-4")}>
        <p className="text-sm text-muted-foreground">
          Your personal workspace goes with it, with its polls, decks, session results and files. In team workspaces,
          what you made stays with the team.
        </p>
        <Blockers status={status} />
        <Button
          variant="destructive"
          disabled={blocked}
          onClick={() => {
            setOpening((n) => n + 1);
            setOpen(true);
          }}
        >
          Delete account…
        </Button>
      </div>
      <DeleteAccountDialog key={opening} open={open} onOpenChange={setOpen} status={status} onRefused={onRefused} />
    </section>
  );
}

/** /settings/privacy: download your data, how long results are kept, delete your account (W4-C). */
export function PrivacySettings() {
  const { status, loading, failed, retry, refresh } = usePrivacyStatus();

  if (failed) return <SettingsFailed message="Your privacy settings could not be loaded." onRetry={retry} />;
  if (loading || !status) return <SettingsLoading>Loading your privacy settings…</SettingsLoading>;

  return (
    <div className="space-y-12">
      <DataSection status={status} onExported={() => void refresh()} />
      <DeleteSection status={status} onRefused={() => void refresh()} />
    </div>
  );
}
