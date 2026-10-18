"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiErrorMessage } from "@/lib/api-error";
import { joinPresentation } from "../../api/participant";
import { useLive, useLiveStore } from "../../live/store";
import { readSession, writeSession } from "./participantSession";

const ease = [0.32, 0.72, 0, 1] as const;

/** Nickname form shown until the participant has joined this deck. */
export function JoinGate({ code }: { code: string }) {
  const t = useTranslations("live.participant");
  const store = useLiveStore();
  const title = useLive((s) => s.title);
  const presentationId = useLive((s) => s.presentationId);
  const [nameInput, setNameInput] = useState("");
  const [joining, setJoining] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!presentationId) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      toast.error(t("nicknameRequired"));
      return;
    }

    setJoining(true);
    try {
      const joined = await joinPresentation(presentationId, trimmed, readSession(code).deviceToken);
      const self = { participantId: joined.participantId, name: joined.name, token: joined.token };
      store.getState().dispatch({ type: "participant/joined", self });
      writeSession(code, { ...self, deviceToken: joined.deviceToken });
      toast.success(t("welcome", { name: joined.name }));
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || t("joinFailed"));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="min-h-screen bg-deck-bg text-deck-fg flex flex-col justify-center items-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease }}
        className="w-full max-w-sm space-y-6 text-center"
      >
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-deck-muted-fg">{t("nicknamePrompt")}</p>
        </div>

        <form onSubmit={handleJoin} className="space-y-3">
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder={t("nicknamePlaceholder")}
            autoFocus
            className="h-12 rounded-xl text-center font-bold"
          />
          <Button
            type="submit"
            disabled={joining || !nameInput.trim()}
            className="w-full h-12 rounded-xl bg-deck-primary text-deck-primary-fg font-semibold"
          >
            {joining ? <Loader2 className="size-4 animate-spin" /> : t("joinSubmit")}
          </Button>
        </form>
      </motion.div>
    </div>
  );
}
