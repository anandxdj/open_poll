"use client";

import { useState } from "react";
import { Search, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterParticipants, pageOf } from "../query";
import type { ReportParticipant } from "../types";

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
    <section aria-labelledby="participants-title" className="rounded-[2rem] border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="participants-title" className="flex items-center gap-2 text-base font-bold tracking-tight">
          <Users className="size-4 text-primary" /> {t("title")}
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">{participants.length}</span>
        </h2>
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
              className="rounded-xl pl-8"
            />
          </div>
        ) : null}
      </div>

      {participants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noMatches", { query: query.trim() })}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                  <th scope="col" className="w-16 py-2 pr-3">{t("colRank")}</th>
                  <th scope="col" className="py-2 pr-3">{t("colName")}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{t("colScore")}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{t("colCorrect")}</th>
                  <th scope="col" className="py-2 text-right">{t("colAnswered")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {current.rows.map((p) => (
                  <tr key={p.participantId}>
                    <td className="py-2.5 pr-3 font-mono text-xs font-bold text-muted-foreground">#{p.rank}</td>
                    <td className="max-w-[16rem] truncate py-2.5 pr-3 font-semibold text-foreground/90">
                      {p.name}
                      {p.kicked ? (
                        <span className="ml-2 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-500">
                          {t("removed")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{p.score.toLocaleString()}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{p.correctCount}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {p.answeredCount}
                      {responseSlides > 0 ? ` / ${responseSlides}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current.pages > 1 ? (
            <nav aria-label={t("title")} className="mt-3 flex items-center justify-between gap-3">
              <Button variant="outline" size="sm" className="rounded-xl" disabled={current.page === 0} onClick={() => setPage(current.page - 1)}>
                {t("previous")}
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("pageOf", { page: current.page + 1, pages: current.pages })}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
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
