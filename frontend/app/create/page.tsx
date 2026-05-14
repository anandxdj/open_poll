import { PollBuilder } from "@/features/polls/components/PollBuilder";
import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Poll",
  description: "Build a new poll with the Open Poll creator studio.",
};

export default function CreatePage() {
  return (
    <Suspense>
      <PollBuilder />
    </Suspense>
  );
}
