"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Code2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getApiErrorMessage } from "@/lib/api-error";
import { getApiOrigin } from "@/lib/env";
import { useWorkspaceStore } from "@/features/workspaces/store/useWorkspaceStore";
import { getEmbedInfo, setEmbedAllowed } from "../api";
import { iframeSnippet, liveEmbedUrl, oembedUrl, resizeScript } from "../embedUrls";
import { CopyField } from "./CopyField";
import { ScreenLinks } from "./ScreenLinks";

export interface EmbedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presentationId: string;
  title: string;
  /** Known to the library card; the builder lets the dialog read it. */
  joinCode?: string;
}

/**
 * The deck's "Embed" dialog (W4-D), from the library card menu and the
 * builder: the embedding switch, the participant view's iframe code and
 * oEmbed URL, and the deck's screen links (read-only stages). Results are
 * embedded from a session's Share dialog, where their link lives.
 */
export function EmbedDialog({ open, onOpenChange, presentationId, title, joinCode }: EmbedDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Code2 className="size-4" /> Embed “{title}”
          </DialogTitle>
          <DialogDescription>
            Put the participant view or the live stage on a website, a room screen or in PowerPoint, Teams and Zoom.
          </DialogDescription>
        </DialogHeader>
        {open ? <EmbedDialogBody presentationId={presentationId} title={title} joinCode={joinCode} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function EmbedDialogBody({ presentationId, title, joinCode }: Omit<EmbedDialogProps, "open" | "onOpenChange">) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loadedCode, setLoadedCode] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const origins = useWorkspaceStore((state) =>
    state.current && state.current.workspace._id === state.currentWorkspaceId ? state.current.workspace.settings.embedAllowedOrigins : null
  );

  useEffect(() => {
    let cancelled = false;
    getEmbedInfo(presentationId).then(
      (info) => {
        if (cancelled) return;
        setAllowed(info.allowed);
        setLoadedCode(info.joinCode);
      },
      () => !cancelled && setAllowed(false)
    );
    return () => {
      cancelled = true;
    };
  }, [presentationId]);

  async function toggle(next: boolean) {
    setSaving(true);
    try {
      setAllowed(await setEmbedAllowed(presentationId, next));
      toast.success(next ? "Embedding turned on" : "Embedding turned off");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't change embedding");
    } finally {
      setSaving(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const code = joinCode ?? loadedCode;
  const liveUrl = code ? liveEmbedUrl(origin, code) : "";

  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="embed-allowed" className="text-sm font-medium">
            Allow embedding
          </Label>
          <p className="text-xs text-muted-foreground">
            Lets this deck&apos;s participant view, stage and shared results appear outside Open Poll.{" "}
            {origins === null ? null : origins.length > 0 ? <>Only on {origins.join(", ")}. </> : <>On any site. </>}
            <Link href="/settings/workspace#embedding" className="underline underline-offset-4">
              Choose sites
            </Link>
          </p>
        </div>
        {allowed === null ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
        ) : (
          <Switch id="embed-allowed" checked={allowed} disabled={saving} onCheckedChange={(next) => void toggle(next)} />
        )}
      </div>

      <section className="space-y-3" aria-labelledby="embed-live-heading">
        <div>
          <h3 id="embed-live-heading" className="text-sm font-semibold">
            Participant view
          </h3>
          <p className="text-xs text-muted-foreground">People join and answer right on your page, with the deck&apos;s join code.</p>
        </div>
        {liveUrl ? (
          <>
            <CopyField label="Embed code" value={iframeSnippet(liveUrl, title, "live")} multiline />
            <CopyField label="Page link" value={liveUrl} />
            <CopyField
              label="oEmbed URL"
              value={oembedUrl(getApiOrigin(), liveUrl)}
              hint="For sites that embed from a link (WordPress, Notion, Slack…), paste the page link; this is what they ask."
            />
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading
          </p>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium text-foreground">Fit the frame to its content</summary>
          <div className="mt-2 space-y-2">
            <p>The embedded page reports its height. Add this once to your page and each frame grows and shrinks to fit.</p>
            <CopyField label="Resize script" value={resizeScript(origin)} multiline />
          </div>
        </details>
      </section>

      <section className="space-y-3" aria-labelledby="embed-stage-heading">
        <div>
          <h3 id="embed-stage-heading" className="text-sm font-semibold">
            Stage for screens
          </h3>
          <p className="text-xs text-muted-foreground">
            A read-only copy of what your stage shows, following the session live: for a second screen, a web page or an
            add-in. Each screen gets its own link, which you can turn off at any time.
          </p>
        </div>
        <ScreenLinks presentationId={presentationId} title={title} embedAllowed={allowed === true} />
      </section>

      <p className="border-t border-border pt-4 text-xs text-muted-foreground">
        To embed a finished session&apos;s results, open its report and choose Share.
      </p>
    </div>
  );
}
