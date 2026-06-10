"use client";

import { useParams } from "next/navigation";
import { HostView } from "@/features/quizzes/components/HostView";

export default function QuizHostPage() {
  const params = useParams();
  const quizId = typeof params?.id === "string" ? params.id : undefined;

  if (!quizId) return null;
  return <HostView quizId={quizId} />;
}
