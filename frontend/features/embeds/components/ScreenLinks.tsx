"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Loader2, MonitorPlay, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiErrorMessage } from "@/lib/api-error";
import { getApiOrigin } from "@/lib/env";
import { createScreenToken, listScreenTokens, revokeScreenToken, type CreatedScreenToken, type ScreenTokenView } from "../api";
import { iframeSnippet, oembedUrl, stageEmbedUrl } from "../embedUrls";
import { CopyField } from "./CopyField";

/**
 * A deck's screen links (W4-D): read-only stages for room screens, web pages
 * and add-in panes. Create one with a name (its link is shown once, then only
 * its first and last characters), turn one off (connected screens leave at
 * once). Turning off asks first, in place: native confirm() is a no-op in
 * embedded browsers.
 */
export function ScreenLinks({ presentationId, title, embedAllowed }: { presentationId: string; title: string; embedAllowed: boolean }) {
  const [tokens, setTokens] = useState<ScreenTokenView[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedScreenToken | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listScreenTokens(presentationId);
      setTokens(list);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [presentationId]);

  useEffect(() => {
    let cancelled = false;
    listScreenTokens(presentationId).then(
      (list) => !cancelled && setTokens(list),
      () => !cancelled && setLoadFailed(true)
    );
    return () => {
      cancelled = true;
    };
  }, [presentationId]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (!name) return;
    setCreating(true);
    try {
      const token = await createScreenToken(presentationId, name);
      setCreated(token);
      setLabel("");
      setTokens((current) => [token, ...(current ?? [])]);
      toast.success("Screen link created");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't create the screen link");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await revokeScreenToken(id);
      setTokens((current) => (current ?? []).filter((token) => token.id !== id));
      if (created?.id === id) setCreated(null);
      setConfirmingId(null);
      toast.success("Screen link turned off");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't turn the screen link off");
    } finally {
      setRevokingId(null);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const createdUrl = created ? stageEmbedUrl(origin, presentationId, created.token) : null;

  return (
    <div className="space-y-4">
      {!embedAllowed ? (
        <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
          Screen links work once embedding is on.
        </p>
      ) : null}

      {created && createdUrl ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-4" aria-live="polite">
          <p className="text-sm font-medium">
            “{created.label}” is ready. Copy its link now: it won&apos;t be shown again.
          </p>
          <CopyField label="Screen link" value={createdUrl} hint="Open it on the screen, or paste it into a PowerPoint, Teams or Zoom add-in." />
          <CopyField label="Stage embed code" value={iframeSnippet(createdUrl, title, "stage")} multiline />
          <CopyField label="oEmbed URL" value={oembedUrl(getApiOrigin(), createdUrl)} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setCreated(null)}>
            Done
          </Button>
        </div>
      ) : null}

      <form onSubmit={(event) => void create(event)} className="flex gap-2">
        <label htmlFor="screen-link-name" className="sr-only">
          Screen name
        </label>
        <Input
          id="screen-link-name"
          value={label}
          maxLength={80}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Name the screen, e.g. Main hall"
          className="bg-card"
        />
        <Button type="submit" variant="outline" className="shrink-0 bg-card" disabled={creating || !label.trim()}>
          {creating ? <Loader2 className="animate-spin" /> : <Plus />}
          Create screen link
        </Button>
      </form>

      {loadFailed ? (
        <p className="text-sm text-muted-foreground">
          Couldn&apos;t load the screen links.{" "}
          <button type="button" className="underline underline-offset-4" onClick={() => void load()}>
            Try again
          </button>
        </p>
      ) : tokens === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading screen links
        </p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">No screen links yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label="Screen links">
          {tokens.map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <MonitorPlay aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{token.label}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {token.prefix}…{token.last4} ·{" "}
                  {token.lastUsedAt ? `used ${formatDistanceToNowStrict(new Date(token.lastUsedAt), { addSuffix: true })}` : "never used"}
                </p>
              </div>
              {confirmingId === token.id ? (
                <div className="flex items-center gap-2" role="group" aria-label={`Turn off ${token.label}?`}>
                  <span className="text-xs text-muted-foreground">Turn off? Its screens go blank.</span>
                  <Button type="button" size="sm" variant="destructive" disabled={revokingId === token.id} onClick={() => void revoke(token.id)}>
                    {revokingId === token.id ? <Loader2 className="animate-spin" /> : null}
                    Turn off
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingId(null)}>
                    Keep
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmingId(token.id)} aria-label={`Turn off ${token.label}`}>
                  <X /> Turn off
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
