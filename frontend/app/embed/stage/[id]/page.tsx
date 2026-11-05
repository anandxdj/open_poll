import { EmbedFrame } from "@/features/embeds/components/EmbedFrame";
import { EmbedNotice } from "@/features/embeds/components/EmbedNotice";
import { ScreenStage } from "@/features/embeds/components/ScreenStage";
import { embedNotice } from "@/features/embeds/verdict";

/**
 * `/embed/stage/<deckId>?token=<screen token>`: the deck's stage, read-only,
 * filling the frame (a room screen, a web page, an add-in pane).
 */
export default async function EmbedStagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ id }, { token }, notice] = await Promise.all([params, searchParams, embedNotice()]);
  const screenToken = typeof token === "string" ? token : null;
  return (
    <EmbedFrame kind="stage" fit="viewport">
      {notice || !screenToken ? (
        <EmbedNotice kind={notice ?? "notFound"} />
      ) : (
        <ScreenStage key={`${id}:${screenToken}`} presentationId={id} screenToken={screenToken} />
      )}
    </EmbedFrame>
  );
}
