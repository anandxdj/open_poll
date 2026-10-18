import { redirect } from "next/navigation";

// Decks live in the unified library; this keeps old /presentations links working.
export default function PresentationsPage() {
  redirect("/polls?type=presentation");
}
