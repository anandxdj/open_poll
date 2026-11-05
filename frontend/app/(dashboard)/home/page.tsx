import type { Metadata } from "next";

import { HomeView } from "@/features/home/components/HomeView";

export const metadata: Metadata = { title: "Home" };

// Where a creator lands after signing in (HOME_PATH): what is live, ways to
// start, the workspace's numbers, recent work and recent sessions.
export default function HomePage() {
  return <HomeView />;
}
