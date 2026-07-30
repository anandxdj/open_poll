"use client";

import { HostView as QuizHostView } from "@/features/quizzes/components/HostView";

interface HostViewProps {
  presentationId: string;
  quizId?: string;
}

export function HostView({ presentationId, quizId }: HostViewProps) {
  return <QuizHostView quizId={presentationId || quizId || ""} />;
}
