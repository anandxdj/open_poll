"use client";

import { QnaBoard } from "@/features/qna/components/QnaBoard";
import type { StageViewProps } from "../../runtime";

/** The Q&A slide on the stage: the session's questions. Thumbnails draw the empty look. */
export function QnaStage({ mode }: StageViewProps) {
  return <QnaBoard thumbnail={mode === "thumbnail"} />;
}
