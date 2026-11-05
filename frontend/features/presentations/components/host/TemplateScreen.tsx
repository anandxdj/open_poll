"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createDeckFromTemplate } from "@/features/templates/api";
import { getApiErrorMessage } from "@/lib/api-error";
import { useLive } from "../../live/store";

const primaryButton =
  "rounded-full bg-deck-accent font-semibold text-deck-stage-ink transition-colors hover:bg-deck-accent-soft";
const outlineButton =
  "rounded-full border-deck-stage-fg/20 bg-transparent font-medium text-deck-stage-fg hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg";

/**
 * A workspace template (W3-B2) opened by a direct link in the host console or
 * the presenter view: the API refuses to present it (TEMPLATE_NOT_PRESENTABLE),
 * so the surface offers a deck made from it instead.
 */
export function TemplateScreen({ presentationId }: { presentationId: string }) {
  const t = useTranslations("presenter");
  const router = useRouter();
  const deckTitle = useLive((s) => s.deck?.title ?? "");
  const [creatingDeck, setCreatingDeck] = useState(false);

  const makeDeck = async () => {
    setCreatingDeck(true);
    try {
      const deck = await createDeckFromTemplate(presentationId);
      router.push(`/presentation/create?id=${deck._id}`);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) ?? t("template.failed"));
      setCreatingDeck(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-deck-stage-bg px-6 text-center text-deck-stage-fg">
      <LayoutTemplate className="size-8 text-deck-accent" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-[-0.03em]">{t("template.title")}</h1>
      <p className="max-w-md text-sm text-deck-stage-fg/70">{t("template.body", { title: deckTitle })}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => void makeDeck()} disabled={creatingDeck} className={`h-12 px-8 text-sm ${primaryButton}`}>
          {creatingDeck ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
          {t("template.use")}
        </Button>
        <Button variant="outline" onClick={() => router.push("/templates")} className={`h-12 px-6 text-sm ${outlineButton}`}>
          {t("template.back")}
        </Button>
      </div>
    </div>
  );
}
