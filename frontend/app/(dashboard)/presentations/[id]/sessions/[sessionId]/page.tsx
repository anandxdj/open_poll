import { SessionsIntlProvider } from "@/features/sessions/SessionsIntlProvider";
import { SessionReportView } from "@/features/sessions/components/SessionReportView";

// The report of one run: results per slide, standings, participants, export and sharing.
export default async function SessionReportPage({ params }: { params: Promise<{ id: string; sessionId: string }> }) {
  const { id, sessionId } = await params;
  return (
    <SessionsIntlProvider>
      <SessionReportView presentationId={id} sessionId={sessionId} />
    </SessionsIntlProvider>
  );
}
