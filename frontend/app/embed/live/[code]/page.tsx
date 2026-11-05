import { ParticipantShell } from "@/features/presentations/components/participant/ParticipantShell";
import { EmbedFrame } from "@/features/embeds/components/EmbedFrame";
import { EmbedNotice } from "@/features/embeds/components/EmbedNotice";
import { embedNotice } from "@/features/embeds/verdict";

/** `/embed/live/<code>`: the participant's join and answer view, chromeless, sized to its content. */
export default async function EmbedLivePage({ params }: { params: Promise<{ code: string }> }) {
  const [{ code }, notice] = await Promise.all([params, embedNotice()]);
  return (
    <EmbedFrame kind="live" fit="content">
      {notice ? <EmbedNotice kind={notice} /> : <ParticipantShell key={code} code={code} />}
    </EmbedFrame>
  );
}
