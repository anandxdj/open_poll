import { TeamsStage } from "@/features/embeds/addins/Panes";

/** What the side panel shares to a Teams meeting's stage (`?link=<screen link>`). */
export default async function TeamsStagePage({ searchParams }: { searchParams: Promise<{ link?: string | string[] }> }) {
  const { link } = await searchParams;
  return <TeamsStage link={typeof link === "string" ? link : null} />;
}
