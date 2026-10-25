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
        {/* The app's graph paper, fading toward the edges */}
        <div aria-hidden="true" className="mk-grid pointer-events-none fixed inset-0" />

        <main className="relative z-10 flex-1 flex items-center justify-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="w-full max-w-sm space-y-8 text-center"
          >
            <div className="space-y-3">
              <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-deck-border bg-deck-surface">
                <PresentationIcon className="size-6 text-deck-primary" />
              </div>
              <h1 className="text-4xl font-semibold tracking-[-0.04em]">{t("title")}</h1>
              <p className="text-base text-deck-muted-fg">{t("subtitle")}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={t("codePlaceholder")}
                inputMode="numeric"
                autoFocus
                className="h-16 rounded-xl bg-deck-surface text-center font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums placeholder:text-deck-muted-fg/40 md:text-3xl"
              />
              <Button
                type="submit"
                disabled={checking || code.length < 6}
                className="h-12 w-full rounded-lg bg-deck-primary text-base font-semibold text-deck-primary-fg"
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

        <footer className="relative z-10 py-5 text-center text-sm text-deck-muted-fg">
          {t("poweredBy")}
        </footer>
      </div>
    </DeckThemeProvider>
  );
}
