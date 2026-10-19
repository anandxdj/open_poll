"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { DeckError } from "./types";

/** An error of the flow, in the author's words. */
export function AiDeckError({ error }: { error: DeckError }) {
  const t = useTranslations("ai.deck.errors");
  const text = (() => {
    switch (error.kind) {
      case "limit":
        return error.max !== undefined ? t("limit", { max: error.max }) : t("limitGeneric");
      case "rate":
        return t("rate");
      case "provider":
        return t("provider");
      case "empty":
        return t("empty");
      case "forbidden":
        return t("forbidden");
      case "invalid":
        return t("invalid", { message: error.message ?? "" });
      case "network":
        return t("network");
      default:
        return t("unknown");
    }
  })();
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <p>{text}</p>
    </div>
  );
}
