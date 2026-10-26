"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterParticipants, pageOf } from "../query";
import type { ReportParticipant } from "../types";
import { SectionTitle } from "./ui";

/** Every participant with score and answers; client-side search and paging (the report carries them all). */
export function ParticipantsTable({
  participants,
  responseSlides,
}: {
  participants: ReportParticipant[];
  responseSlides: number;
}) {
  const t = useTranslations("sessions.report.participants");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const filtered = filterParticipants(participants, query);
  const current = pageOf(filtered, page);

  return (
    <section aria-labelledby="participants-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionTitle id="participants-title" count={participants.length}>
          {t("title")}
        </SectionTitle>
        {participants.length > 0 ? (
          <div className="relative w-full sm:w-64">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder={t("search")}
              aria-label={t("search")}
              maxLength={60}
              className="h-9 bg-card pl-8"
            />
          </div>
        ) : null}
      </div>

      {participants.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">{t("empty")}</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-border bg-card px-5 py-6 text-sm text-muted-foreground">
          {t("noMatches", { query: query.trim() })}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="w-16 py-3 pl-5 pr-3 font-normal">{t("colRank")}</th>
                  <th scope="col" className="py-3 pr-3 font-normal">{t("colName")}</th>
                  <th scope="col" className="py-3 pr-3 text-right font-normal">{t("colScore")}</th>
                  <th scope="col" className="py-3 pr-3 text-right font-normal">{t("colCorrect")}</th>
                  <th scope="col" className="py-3 pr-5 text-right font-normal">{t("colAnswered")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {current.rows.map((p) => (
                  <tr key={p.participantId}>
                    <td className="py-3 pl-5 pr-3 font-mono tabular-nums text-muted-foreground">{p.rank}</td>
                    <td className="max-w-[16rem] truncate py-3 pr-3 font-medium text-foreground">
                      {p.name}
                      {p.kicked ? (
                        <span className="ml-2 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          {t("removed")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono tabular-nums text-foreground">{p.score.toLocaleString()}</td>
                    <td className="py-3 pr-3 text-right font-mono tabular-nums text-muted-foreground">{p.correctCount}</td>
                    <td className="py-3 pr-5 text-right font-mono tabular-nums text-muted-foreground">
                      {p.answeredCount}
                      {responseSlides > 0 ? ` / ${responseSlides}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current.pages > 1 ? (
            <nav aria-label={t("title")} className="flex items-center justify-between gap-3">
              <Button variant="outline" size="sm" className="bg-card" disabled={current.page === 0} onClick={() => setPage(current.page - 1)}>
                {t("previous")}
              </Button>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {t("pageOf", { page: current.page + 1, pages: current.pages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="bg-card"
                disabled={current.page >= current.pages - 1}
                onClick={() => setPage(current.page + 1)}
              >
                {t("next")}
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
