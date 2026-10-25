import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";

// The host console renders the same slide views and standings as the
// participant routes (messages/en/live.json) plus its own chrome
// (messages/en/presenter.json); LiveIntlProvider ships both.
export default function PresentationHostLayout({ children }: { children: React.ReactNode }) {
  return <LiveIntlProvider>{children}</LiveIntlProvider>;
}
