import { EmbedFrame } from "@/features/embeds/components/EmbedFrame";
import { EmbedNotice } from "@/features/embeds/components/EmbedNotice";
import { ResultsEmbed } from "@/features/embeds/components/ResultsEmbed";
import { embedNotice } from "@/features/embeds/verdict";

/** `/embed/results/<token>`: a shared session's results (what `/r/<token>` shows), chromeless. */
export default async function EmbedResultsPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, notice] = await Promise.all([params, embedNotice()]);
  return (
    <EmbedFrame kind="results" fit="content">
      {notice ? <EmbedNotice kind={notice} /> : <ResultsEmbed token={token} />}
    </EmbedFrame>
  );
}
