"use client";

import { useState, type FormEvent } from "react";
import { Loader2, MessageCircleQuestion, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLive, useLiveStore } from "@/features/presentations/live/store";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { askQuestion, setUpvote } from "../api";
import { isQnaOpen, qnaActions, questionsWithStatus, sortQuestions, type QnaItem, type QnaSort } from "../state";
import { QNA_TEXT_MAX } from "../types";
import { selectQna, useQnaSync } from "../useQnaSync";
import { QuestionCard } from "./QuestionCard";

/**
 * The participant's Q&A: ask form, the visible questions with upvotes, and the
 * participant's own questions waiting for approval. Rendered as the Q&A tab
 * and on a Q&A slide's phone view.
 */
export function QnaPanel({ className }: { className?: string }) {
  const t = useTranslations("qna");
  const store = useLiveStore();
  const { failed, retry } = useQnaSync();
  const qna = useLive(selectQna);
  const status = useLive((s) => s.status);
  const self = useLive((s) => s.self);
  const presentationId = useLive((s) => s.presentationId);

  const [text, setText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null);
  const [sort, setSort] = useState<QnaSort>("top");
  const [voting, setVoting] = useState<ReadonlySet<string>>(new Set());

  const open = isQnaOpen(qna, status);
  const settings = qna.settings;
  const canAskAnonymously = settings?.anonymousAllowed ?? true;
  const left = QNA_TEXT_MAX - text.length;

  const visible = sortQuestions(
    [
      ...questionsWithStatus(qna, "public"),
      ...questionsWithStatus(qna, "pending").filter((item) => item.mine),
    ],
    sort
  );
  // Own questions waiting for approval stay on top: they are what the participant just did.
  const ordered: QnaItem[] = [
    ...visible.filter((item) => item.status === "pending"),
    ...visible.filter((item) => item.status !== "pending"),
  ];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !presentationId || !self || sending) return;
    setSending(true);
    setNotice(null);
    try {
      const question = await askQuestion(
        presentationId,
        { participantId: self.participantId, token: self.token },
        { text: trimmed, anonymous: anonymous && canAskAnonymously }
      );
      store.getState().dispatch(qnaActions.asked(question));
      setText("");
      setNotice({ tone: "ok", message: question.status === "pending" ? t("ask.sentPending") : t("ask.sentVisible") });
    } catch (err: unknown) {
      setNotice({ tone: "error", message: getApiErrorMessage(err) ?? t("ask.failed") });
    } finally {
      setSending(false);
    }
  };

  const toggleUpvote = async (item: QnaItem) => {
    if (!presentationId || !self || voting.has(item.id)) return;
    setVoting((prev) => new Set(prev).add(item.id));
    try {
      const result = await setUpvote(
        presentationId,
        { participantId: self.participantId, token: self.token },
        item.id,
        !item.upvoted
      );
      store.getState().dispatch(qnaActions.voted(result));
      setNotice(null);
    } catch (err: unknown) {
      setNotice({ tone: "error", message: getApiErrorMessage(err) ?? t("list.voteFailed") });
    } finally {
      setVoting((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  if (!qna.loaded) {
    return (
      <div className={cn("w-full py-10 text-center text-sm text-deck-muted-fg", className)} role="status">
        {failed ? (
          <div className="space-y-3">
            <p>{t("loadFailed")}</p>
            <Button type="button" variant="outline" onClick={retry} className="rounded-xl">
              {t("retry")}
            </Button>
          </div>
        ) : (
          <Loader2 className="mx-auto size-6 animate-spin text-deck-primary/60" aria-label={t("title")} />
        )}
      </div>
    );
  }

  return (
    <section className={cn("w-full space-y-4", className)} aria-label={t("title")}>
      <header className="flex items-center gap-2 text-sm font-bold text-deck-primary">
        <MessageCircleQuestion className="size-4" aria-hidden /> {t("title")}
      </header>

      {open ? (
        <form onSubmit={submit} className="space-y-2.5">
          <label htmlFor="qna-ask" className="sr-only">
            {t("ask.label")}
          </label>
          <Textarea
            id="qna-ask"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={QNA_TEXT_MAX}
            placeholder={t("ask.placeholder")}
            rows={3}
            className="min-h-20 resize-none rounded-2xl border-deck-border/60 bg-deck-surface/60 text-deck-fg"
          />
          <div className="flex items-center justify-between gap-3 text-xs text-deck-muted-fg">
            {canAskAnonymously ? (
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                  className="size-4 accent-deck-primary"
                />
                {t("ask.anonymous")}
              </label>
            ) : (
              <span />
            )}
            <span className={cn("tabular-nums", left < 20 && "text-deck-danger-soft")}>{t("ask.left", { count: left })}</span>
          </div>
          {settings?.moderation && <p className="text-xs text-deck-muted-fg">{t("ask.moderated")}</p>}
          <Button
            type="submit"
            disabled={sending || !text.trim()}
            className="h-11 w-full rounded-xl bg-deck-primary font-semibold text-deck-primary-fg"
          >
            {sending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden /> {t("ask.sending")}
              </>
            ) : (
              <>
                <Send className="size-4" aria-hidden /> {t("ask.send")}
              </>
            )}
          </Button>
        </form>
      ) : (
        <div className="rounded-2xl border border-deck-border/50 bg-deck-surface/40 px-4 py-5 text-center" role="status">
          <p className="text-sm font-semibold">{status === "ended" ? t("ended") : t("closed")}</p>
          {status !== "ended" && <p className="mt-1 text-xs text-deck-muted-fg">{t("closedHint")}</p>}
        </div>
      )}

      {notice && (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={cn("text-xs font-medium", notice.tone === "error" ? "text-deck-danger-soft" : "text-deck-correct-soft")}
        >
          {notice.message}
        </p>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-deck-muted-fg/70">{t("list.label")}</h3>
        <div className="inline-flex rounded-full border border-deck-border/50 p-0.5 text-[11px] font-semibold" role="group" aria-label={t("list.label")}>
          {(["top", "new"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSort(value)}
              aria-pressed={sort === value}
              className={cn(
                "rounded-full px-2.5 py-1 transition-colors",
                sort === value ? "bg-deck-primary/15 text-deck-primary" : "text-deck-muted-fg hover:text-deck-fg"
              )}
            >
              {value === "top" ? t("list.sortTop") : t("list.sortNew")}
            </button>
          ))}
        </div>
      </div>

      {ordered.length === 0 ? (
        <p className="py-4 text-center text-sm text-deck-muted-fg">{t("list.empty")}</p>
      ) : (
        <ul className="space-y-2.5">
          {ordered.map((item) => (
            <QuestionCard
              key={item.id}
              item={item}
              onStage={qna.highlightedId === item.id}
              canUpvote={settings?.upvotes ?? true}
              voting={voting.has(item.id)}
              onToggleUpvote={(target) => void toggleUpvote(target)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
