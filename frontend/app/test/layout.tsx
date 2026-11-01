import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NO_INDEX } from "@/lib/seo/site";

// Component test pages for development; a production build answers 404.
export const metadata: Metadata = { title: "Test", robots: NO_INDEX };

export default function TestLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
