"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Presentation as PresentationIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPresentationByCode } from "@/features/presentations/api/participant";
import { DeckThemeProvider } from "@/features/presentations/theme/DeckThemeProvider";

const ease = [0.32, 0.72, 0, 1] as const;

export default function LiveJoinPage() {
  const t = useTranslations("live.join");
  const router = useRouter();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      toast.error(t("invalidCode"));
      return;
    }
    setChecking(true);
    try {
      await getPresentationByCode(trimmed);
      router.push(`/live/${trimmed}`);
    } catch {
      toast.error(t("notFound"));
    } finally {
      setChecking(false);
    }
  };

  return (
    <DeckThemeProvider>
      <div className="min-h-screen bg-deck-bg text-deck-fg flex flex-col">
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-deck-primary/[0.04] blur-[120px] rounded-full" />
        </div>

        <main className="relative z-10 flex-1 flex items-center justify-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="w-full max-w-sm space-y-8 text-center"
          >
            <div className="space-y-3">
              <div className="size-14 rounded-2xl bg-deck-primary/15 border border-deck-primary/30 flex items-center justify-center mx-auto">
                <PresentationIcon className="size-6 text-deck-primary" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
              <p className="text-sm text-deck-muted-fg/60">{t("subtitle")}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("codePlaceholder")}
                inputMode="numeric"
                autoFocus
                className="h-16 rounded-2xl bg-deck-secondary/15 border-deck-border/40 text-center text-3xl font-black tracking-[0.4em] tabular-nums placeholder:text-deck-muted-fg/20"
              />
              <Button
                type="submit"
                disabled={checking || code.length < 6}
                className="w-full h-12 rounded-2xl bg-deck-primary text-deck-primary-fg font-semibold text-base"
              >
                {checking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    {t("submit")} <ArrowRight className="size-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </motion.div>
        </main>

        <footer className="relative z-10 text-center py-4 text-[10px] font-medium text-deck-muted-fg/30 uppercase tracking-widest">
          {t("poweredBy")}
        </footer>
      </div>
    </DeckThemeProvider>
  );
}
