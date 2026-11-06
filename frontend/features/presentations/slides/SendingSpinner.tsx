"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * What an answer form's submit button shows while the answer is on its way: a
 * spinner, and the words for screen readers, so the button never loses its
 * name (W4-A).
 */
export function SendingSpinner({ className = "size-5" }: { className?: string }) {
  const t = useTranslations("live.participant");
  return (
    <>
      <Loader2 className={`${className} animate-spin`} aria-hidden="true" />
      <span className="sr-only">{t("sending")}</span>
    </>
  );
}
