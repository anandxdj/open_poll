"use client";

import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCustomDomain } from "@/features/domains/hooks/useCustomDomain";
import { usePublicResults } from "@/features/sessions/hooks/usePublicResults";
import { PublicResultsContent } from "@/features/sessions/components/PublicResultsView";
import { MessageCard, Skeleton } from "@/features/sessions/components/ui";
import { EmbedNotice } from "./EmbedNotice";

/**
 * `/embed/results/[token]`: a shared session's results (the `/r/[token]`
 * content) without the page around it, and a one-line attribution (none on a
 * white-label custom domain).
 */
export function ResultsEmbed({ token }: { token: string }) {
  const t = useTranslations("sessions.public");
  const te = useTranslations("embeds");
  const domain = useCustomDomain();
  const { results, loading, error, reload } = usePublicResults(token);

  if (error === "unavailable") return <EmbedNotice kind="notFound" />;

  return (
    <div className="bg-background px-4 py-6 text-foreground sm:px-6">
      {loading ? (
        <div role="status" aria-label={t("loading")} className="space-y-6">
          <Skeleton className="h-24" />
          <Skeleton className="h-96" />
        </div>
      ) : error || !results ? (
        <MessageCard tone="error" title={t("loadFailed")}>
          <Button variant="outline" size="sm" className="bg-card" onClick={reload}>
            <RefreshCw /> {t("retry")}
          </Button>
        </MessageCard>
      ) : (
        <PublicResultsContent results={results} />
      )}
      {domain?.whiteLabel ? null : (
        <p className="mt-8 text-center text-xs text-muted-foreground">
          <a href="/" target="_blank" rel="noopener" className="underline underline-offset-4 hover:text-foreground">
            {te("poweredBy")}
          </a>
        </p>
      )}
    </div>
  );
}
