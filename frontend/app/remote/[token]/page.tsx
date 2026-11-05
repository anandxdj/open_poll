"use client";

import { useParams } from "next/navigation";
import { RemoteConsole } from "@/features/remote/RemoteConsole";

// The phone remote (W2-A): opened from the presenter view's pairing QR code.
export default function RemotePage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? decodeURIComponent(params.token) : undefined;

  if (!token) return null;
  return <RemoteConsole key={token} token={token} />;
}
