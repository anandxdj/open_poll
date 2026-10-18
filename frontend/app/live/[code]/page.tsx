"use client";

import { useParams } from "next/navigation";
import { ParticipantShell } from "@/features/presentations/components/participant/ParticipantShell";

export default function LivePlayPage() {
  const params = useParams();
  const code = typeof params?.code === "string" ? params.code : undefined;

  if (!code) return null;
  return <ParticipantShell key={code} code={code} />;
}
