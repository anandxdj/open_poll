import { TeamsSidePanel } from "@/features/embeds/addins/TeamsSidePanel";

/** The Teams tab's page: meeting side panel, chat and channel tabs (`?link=<screen link>`). */
export default async function TeamsSidePanelPage({ searchParams }: { searchParams: Promise<{ link?: string | string[] }> }) {
  const { link } = await searchParams;
  return <TeamsSidePanel link={typeof link === "string" ? link : null} />;
}
