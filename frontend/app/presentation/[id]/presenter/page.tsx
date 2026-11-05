"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { PresenterConsole } from "@/features/presenter/components/PresenterConsole";

export default function PresenterViewPage() {
  const params = useParams<{ id: string }>();
  const presentationId = typeof params?.id === "string" ? params.id : undefined;

  if (!presentationId) return null;
  return (
    <Suspense fallback={null}>
      <PresenterConsole key={presentationId} presentationId={presentationId} />
    </Suspense>
  );
}
