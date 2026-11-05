"use client";

import type { ReactNode } from "react";
import { Ban, Link2Off } from "lucide-react";
import { useTranslations } from "next-intl";

import type { EmbedNoticeKind } from "../verdict";

/**
 * Shown in place of an embed that may not render: the deck does not allow
 * embedding, or the link does not lead anywhere (any more). Says which,
 * never more (no deck title, no owner).
 */
export function EmbedNotice({ kind, children }: { kind: EmbedNoticeKind; children?: ReactNode }) {
  const t = useTranslations("embeds.notice");
  const Icon = kind === "disabled" ? Ban : Link2Off;
  return (
    <div role="status" className="flex min-h-[240px] flex-col items-center justify-center gap-3 bg-background px-6 py-10 text-center text-foreground">
      <Icon aria-hidden className="size-6 text-muted-foreground" />
      <p className="text-lg font-semibold tracking-[-0.02em]">{t(kind === "disabled" ? "disabledTitle" : "notFoundTitle")}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{t(kind === "disabled" ? "disabledHint" : "notFoundHint")}</p>
      {children}
    </div>
  );
}

