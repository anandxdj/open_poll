"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/features/auth/store/useAuthStore";

// Runs on every route. Page chrome is owned by route-group layouts: the
// sidebar lives in app/(dashboard)/layout.tsx.
export default function GlobalClientLayout({ children }: { children: React.ReactNode }) {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return <>{children}</>;
}
