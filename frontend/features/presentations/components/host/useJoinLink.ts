"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { JoinLinkControls } from "../stage/StageLobby";

/** The participant join link for `joinCode`, with copy-to-clipboard feedback. */
export function useJoinLink(joinCode: string): JoinLinkControls {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const playUrl = typeof window !== "undefined" && joinCode ? `${window.location.origin}/live/${joinCode}` : "";

  const copyUrl = async () => {
    if (!playUrl) return;
    try {
      await navigator.clipboard.writeText(playUrl);
      setCopiedUrl(true);
      toast.success("Join link copied to clipboard!");
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      toast.error("Failed to copy link.");
    }
  };

  const copyCode = async () => {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopiedCode(true);
      toast.success("Join code copied to clipboard!");
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error("Failed to copy code.");
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
