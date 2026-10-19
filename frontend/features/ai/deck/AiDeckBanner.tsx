"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { AiIntlProvider } from "./AiIntlProvider";
import { MockDataNotice } from "./AiSourceNotice";
import { AI_SOURCE_PARAM } from "./source";

/**
 * Builder banner for a deck generated in mock mode (`?aiSource=mock`): its slides
 * and notes are placeholders, so the label stays until it is dismissed.
 */
export function AiDeckBanner() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || searchParams.get(AI_SOURCE_PARAM) !== "mock") return null;
  return (
    <AiIntlProvider>
      <MockDataNotice className="shrink-0" onDismiss={() => setDismissed(true)} />
    </AiIntlProvider>
  );
}
