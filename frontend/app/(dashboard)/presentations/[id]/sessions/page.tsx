import { SessionsIntlProvider } from "@/features/sessions/SessionsIntlProvider";
import { SessionsList } from "@/features/sessions/components/SessionsList";

// Every run of a deck, newest first.
export default async function DeckSessionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <SessionsIntlProvider>
      <SessionsList presentationId={id} />
    </SessionsIntlProvider>
  );
}
