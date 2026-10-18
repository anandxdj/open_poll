import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The quiz UI was folded into presentation decks. Old /quiz links are still
  // out there — host bookmarks, and join QR codes printed or shared before the
  // move — so they redirect rather than 404. Query strings carry over, which
  // keeps /quiz/create?id=… and ?name=…&mode=ai working.
  async redirects() {
    return [
      { source: "/quizzes", destination: "/polls", permanent: true },
      { source: "/quiz/create", destination: "/presentation/create", permanent: true },
      { source: "/quiz/host/:id", destination: "/presentation/host/:id", permanent: true },
      { source: "/quiz/join", destination: "/live", permanent: true },
      { source: "/quiz/play/:code", destination: "/live/:code", permanent: true },
    ];
  },
};

export default nextConfig;
