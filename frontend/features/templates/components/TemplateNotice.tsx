"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutTemplate, Loader2, Presentation } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api-error";
import { useAppThemeMode } from "@/features/themes/useAppThemeMode";
import { createDeckFromTemplate, TEMPLATES_PATH } from "../api";

/**
 * What the builder shows for a workspace template opened by a direct link: a
 * template is never edited in place, so it offers "Use template" (a new draft
 * deck, opened in the builder) instead.
 */
export function TemplateNotice({ templateId, title }: { templateId: string; title: string }) {
  const [busy, setBusy] = useState(false);
  const appMode = useAppThemeMode();

  async function use() {
    setBusy(true);
    try {
      const deck = await createDeckFromTemplate(templateId, appMode);
      toast.success(`“${deck.title}” created from the template.`);
      // A full load: the builder starts over on the new deck (its state belongs to this template).
      window.location.assign(`/presentation/create?id=${deck._id}`);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? "Couldn't create a deck from this template.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full w-full items-center justify-center px-4 py-16">
      <section
        aria-labelledby="template-notice-title"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10"
      >
        <div aria-hidden="true" className="mk-grid mk-grid-flat pointer-events-none absolute inset-0" />
        <div className="relative">
          <LayoutTemplate className="mx-auto size-8 text-accent-ink" aria-hidden="true" />
          <h1 id="template-notice-title" className="mt-4 text-2xl font-semibold tracking-[-0.03em]">
            This is a template
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-base text-muted-foreground">
            “{title || "Untitled template"}” is not edited or presented directly. Use it to make a new deck, then edit and present
            that deck.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={() => void use()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Presentation />} Use template
            </Button>
            <Link href={TEMPLATES_PATH} className={buttonVariants({ variant: "outline", className: "bg-card" })}>
              Back to templates
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
