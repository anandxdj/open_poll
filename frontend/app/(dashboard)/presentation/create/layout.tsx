import type { Metadata } from "next";

export const metadata: Metadata = { title: "Deck builder" };

export default function DeckBuilderLayout({ children }: { children: React.ReactNode }) {
  return children;
}
