"use client";

import { useMemo, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { NextIntlClientProvider } from "next-intl";
import { defaultLocale, type Locale } from "@/i18n/config";
import { pickMessages } from "@/i18n/messages";

/**
 * next-intl provider for the embed pages (`/embed/*`) and add-in panes. They
 * draw the participant view (`live`), the stage (`presenter`, `qna`,
 * `slidesAdvanced`) and shared results (`sessions`), plus their own notices
 * (`embeds`). Like the live routes, framer-motion honours reduced motion here (W4-A).
 */
export function EmbedIntlProvider({ locale = defaultLocale, children }: { locale?: Locale; children: ReactNode }) {
  const messages = useMemo(
    () => pickMessages(locale, ["embeds", "live", "presenter", "qna", "sessions", "slidesAdvanced"]),
    [locale]
  );
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextIntlClientProvider>
  );
}
