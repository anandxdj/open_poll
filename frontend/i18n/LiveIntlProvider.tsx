"use client";

import { useMemo, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { NextIntlClientProvider } from "next-intl";
import { defaultLocale, type Locale } from "./config";
import { pickMessages } from "./messages";

/**
 * Client-side next-intl provider for the live routes (`/live/**`,
 * `/presentation/host/**`, `/presentation/[id]/presenter|present`,
 * `/remote/**`). Messages ship with the client bundle, so it needs
 * no request config or `next.config` plugin. English only until W4 adds
 * locales; the participant's browser language picks among them then.
 *
 * It also sets framer-motion to honour `prefers-reduced-motion` on every live
 * surface (W4-A): with reduced motion, slides, springs and layout moves jump
 * to their end state instead of moving (CSS animations: `tokens.css`).
 */
export function LiveIntlProvider({ locale = defaultLocale, children }: { locale?: Locale; children: ReactNode }) {
  const messages = useMemo(() => pickMessages(locale, ["live", "presenter", "qna", "remote", "slidesAdvanced"]), [locale]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextIntlClientProvider>
  );
}
