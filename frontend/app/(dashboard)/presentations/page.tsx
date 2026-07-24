"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PresentationsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/polls");
  }, [router]);

  return null;
}
