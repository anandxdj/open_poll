"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { HostConsole } from "@/features/presentations/components/host/HostConsole";

export default function PresentationHostPage() {
  const params = useParams();
  const presentationId = typeof params?.id === "string" ? params.id : undefined;

  if (!presentationId) return null;
  return (
    <Suspense fallback={null}>
      <HostConsole key={presentationId} presentationId={presentationId} />
    </Suspense>
  );
}
