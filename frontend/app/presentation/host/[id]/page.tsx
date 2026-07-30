"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { HostView } from "@/features/presentations/components/HostView";

export default function PresentationHostPage() {
  const params = useParams();
  const presentationId = typeof params?.id === "string" ? params.id : undefined;

  if (!presentationId) return null;
  return (
    <Suspense fallback={null}>
      <HostView presentationId={presentationId} />
    </Suspense>
  );
}
