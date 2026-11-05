"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { AudienceWindow } from "@/features/presenter/components/AudienceWindow";

// The audience window: opened from the presenter view, kept in step over a BroadcastChannel.
export default function AudienceWindowPage() {
  const params = useParams<{ id: string }>();
  const presentationId = typeof params?.id === "string" ? params.id : undefined;

  if (!presentationId) return null;
  return (
    <Suspense fallback={null}>
      <AudienceWindow key={presentationId} presentationId={presentationId} />
    </Suspense>
  );
}
