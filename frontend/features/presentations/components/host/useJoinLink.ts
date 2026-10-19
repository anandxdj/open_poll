"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { JoinLinkControls } from "../stage/StageLobby";

/** The participant join link for `joinCode`, with copy-to-clipboard feedback. */
export function useJoinLink(joinCode: string): JoinLinkControls {
  const t = useTranslations("presenter.toasts");
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const playUrl = typeof window !== "undefined" && joinCode ? `${window.location.origin}/live/${joinCode}` : "";

  const copyUrl = async () => {
    if (!playUrl) return;
    try {
      await navigator.clipboard.writeText(playUrl);
      setCopiedUrl(true);
      toast.success(t("linkCopied"));
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      toast.error(t("linkCopyFailed"));
    }
  };

  const copyCode = async () => {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopiedCode(true);
      toast.success(t("codeCopied"));
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error(t("codeCopyFailed"));
    }
  };

  return {
    playUrl,
    copiedUrl,
    copiedCode,
    copyUrl: () => void copyUrl(),
    copyCode: () => void copyCode(),
  };
}
