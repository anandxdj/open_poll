"use client";

import { useState } from "react";
import { Archive, Check, Loader2, MonitorOff, MonitorUp, Pin, PinOff, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { useLive, useLiveStore } from "@/features/presentations/live/store";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { highlightHostQuestion, updateHostQuestion } from "../api";
import { qnaActions, questionsWithStatus, sortQuestions, type QnaItem, type QnaSort } from "../state";
import type { QnaStatus } from "../types";
import { selectQna, useQnaSync } from "../useQnaSync";

const FILTERS = ["pending", "visible", "answered", "archived", "rejected"] as const satisfies readonly QnaStatus[];
type Filter = (typeof FILTERS)[number];

type Action =
  | { kind: "status"; status: Exclude<QnaStatus, "pending"> }
  | { kind: "pin"; pinned: boolean }
  | { kind: "highlight"; highlighted: boolean };

interface ActionDef {
  id: string;
  label: string;
  Icon: typeof Check;
  action: Action;
  tone?: "primary" | "danger";
}

/** What the host can do with a question in its current state. */
function actionsFor(item: QnaItem, highlighted: boolean, t: (key: string) => string): ActionDef[] {
  const label = (key: string) => t(`host.actions.${key}`);
  switch (item.status) {
    case "pending":
      return [
        { id: "approve", label: label("approve"), Icon: Check, action: { kind: "status", status: "visible" }, tone: "primary" },
        { id: "reject", label: label("reject"), Icon: X, action: { kind: "status", status: "rejected" }, tone: "danger" },
      ];
    case "visible":
    case "answered": {
      const defs: ActionDef[] = [
        highlighted
          ? { id: "unhighlight", label: label("unhighlight"), Icon: MonitorOff, action: { kind: "highlight", highlighted: false } }
          : { id: "highlight", label: label("highlight"), Icon: MonitorUp, action: { kind: "highlight", highlighted: true }, tone: "primary" },
        item.status === "visible"
          ? { id: "answered", label: label("answered"), Icon: Check, action: { kind: "status", status: "answered" } }
          : { id: "reopen", label: label("reopen"), Icon: Undo2, action: { kind: "status", status: "visible" } },
        item.pinned
          ? { id: "unpin", label: label("unpin"), Icon: PinOff, action: { kind: "pin", pinned: false } }
          : { id: "pin", label: label("pin"), Icon: Pin, action: { kind: "pin", pinned: true } },
        { id: "archive", label: label("archive"), Icon: Archive, action: { kind: "status", status: "archived" } },
      ];
      return defs;
    }
    case "archived":
      return [{ id: "restore", label: label("restore"), Icon: Undo2, action: { kind: "status", status: "visible" } }];
    case "rejected":
      return [{ id: "approve", label: label("approve"), Icon: Check, action: { kind: "status", status: "visible" }, tone: "primary" }];
  }
}

/**
 * Host moderation: filter by status, sort by votes or time, and act on each
 * question (approve, reject, mark answered, pin, show over the stage, archive).
 * Used inside the Q&A drawer and, when W2-A's console renders `presenterPanels`, inline there.
 */
export function HostQnaPanel({ className }: { className?: string }) {
  const t = useTranslations("qna");
  const store = useLiveStore();
  const { failed, retry } = useQnaSync();
  const qna = useLive(selectQna);
  const presentationId = useLive((s) => s.presentationId);

  const [filter, setFilter] = useState<Filter>("pending");
  const [sort, setSort] = useState<QnaSort>("top");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = Object.fromEntries(FILTERS.map((status) => [status, questionsWithStatus(qna, status).length])) as Record<Filter, number>;
  const shown = sortQuestions(questionsWithStatus(qna, filter), sort);

  const run = async (item: QnaItem, def: ActionDef) => {
    if (!presentationId || busy) return;
    setBusy(`${item.id}:${def.id}`);
    setError(null);
    try {
      const { action } = def;
      const updated =
        action.kind === "highlight"
          ? await highlightHostQuestion(presentationId, item.id, action.highlighted)
          : await updateHostQuestion(
              presentationId,
              item.id,
              action.kind === "status" ? { status: action.status } : { pinned: action.pinned }
            );
      store.getState().dispatch(qnaActions.hostUpdated(updated));
    } catch (err: unknown) {
      setError(getApiErrorMessage(err) ?? t("host.failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={cn("flex min-h-0 flex-col gap-3", className)} aria-label={t("host.title")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-deck-stage-fg/60">
        <span>{qna.settings?.moderation ? t("host.moderationOn") : t("host.moderationOff")}</span>
        {qna.loaded && !qna.settings?.open && <span className="text-deck-accent-soft">{t("host.closed")}</span>}
      </div>

      <div role="tablist" aria-label={t("host.title")} className="flex flex-wrap gap-1">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              filter === value
                ? "bg-deck-primary/20 text-deck-primary"
                : "text-deck-stage-fg/60 hover:bg-deck-stage-fg/10 hover:text-deck-stage-fg"
            )}
          >
            {t(`host.filters.${value}`)}
            <span className={cn("tabular-nums", value === "pending" && counts.pending > 0 && "rounded-full bg-deck-accent px-1.5 text-deck-stage-ink")}>
              {counts[value]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 text-[11px] text-deck-stage-fg/60">
        <label htmlFor="qna-host-sort" className="font-semibold">
          {t("host.sortLabel")}
        </label>
        <select
          id="qna-host-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as QnaSort)}
          className="rounded-lg border border-deck-stage-fg/15 bg-deck-stage-panel px-2 py-1 text-xs font-semibold text-deck-stage-fg"
        >
          <option value="top">{t("host.sortTop")}</option>
          <option value="new">{t("host.sortNew")}</option>
        </select>
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-deck-danger-soft">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {!qna.loaded ? (
          <div className="py-8 text-center text-xs text-deck-stage-fg/50" role="status">
            {failed ? (
              <button type="button" onClick={retry} className="underline underline-offset-2">
                {t("retry")}
              </button>
            ) : (
              <Loader2 className="mx-auto size-5 animate-spin" aria-label={t("host.title")} />
            )}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-xs text-deck-stage-fg/50">{t(`host.empty.${filter}`)}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((item) => {
              const highlighted = qna.highlightedId === item.id;
              return (
                <li
                  key={item.id}
                  className={cn(
                    "space-y-2 rounded-2xl border px-3.5 py-3",
                    highlighted ? "border-deck-accent/60 bg-deck-accent/10" : "border-deck-stage-fg/10 bg-deck-stage-fg/[0.04]"
                  )}
                >
                  <p className="text-sm font-medium leading-snug break-words text-deck-stage-fg">{item.text}</p>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-deck-stage-fg/55">
                    <span className="font-semibold">{item.authorName ?? t("host.anonymousAuthor")}</span>
                    <span className="tabular-nums">{t("list.votes", { count: item.upvoteCount })}</span>
                    {item.pinned && (
                      <span className="inline-flex items-center gap-1 text-deck-accent-soft">
                        <Pin className="size-3" aria-hidden /> {t("list.pinned")}
                      </span>
                    )}
                    {highlighted && <span className="font-semibold text-deck-accent-soft">{t("host.highlighted")}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {actionsFor(item, highlighted, t as (key: string) => string).map((def) => (
                      <button
                        key={def.id}
                        type="button"
                        onClick={() => void run(item, def)}
                        disabled={busy !== null}
                        aria-label={`${def.label}: ${item.text}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50",
                          def.tone === "primary" && "border-deck-primary/40 bg-deck-primary/15 text-deck-primary hover:bg-deck-primary/25",
                          def.tone === "danger" && "border-deck-danger/30 text-deck-danger-soft hover:bg-deck-danger/10",
                          !def.tone && "border-deck-stage-fg/15 text-deck-stage-fg/80 hover:bg-deck-stage-fg/10"
                        )}
                      >
                        {busy === `${item.id}:${def.id}` ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <def.Icon className="size-3.5" aria-hidden />
                        )}
                        {def.label}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
