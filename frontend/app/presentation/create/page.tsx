"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { PresentationBuilder } from "@/features/presentations/components/PresentationBuilder";

export default function PresentationCreatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary/60" />
        </div>
      }
    >
      <PresentationBuilder />
    </Suspense>
  );
}
