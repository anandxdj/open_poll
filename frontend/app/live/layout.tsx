import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";

// Participant-facing live routes get translated strings (messages/<locale>/live.json).
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return <LiveIntlProvider>{children}</LiveIntlProvider>;
}
