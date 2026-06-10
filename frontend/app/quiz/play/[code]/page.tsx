"use client";

import { useParams } from "next/navigation";
import { PlayView } from "@/features/quizzes/components/PlayView";

export default function QuizPlayPage() {
  const params = useParams();
  const code = typeof params?.code === "string" ? params.code : undefined;

  if (!code) return null;
  return <PlayView code={code} />;
}
