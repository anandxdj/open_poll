import { LiveIntlProvider } from "@/i18n/LiveIntlProvider";

// The host console renders the same slide views and standings as the
// participant routes, so it shares their message namespace.
export default function PresentationHostLayout({ children }: { children: React.ReactNode }) {
  return <LiveIntlProvider>{children}</LiveIntlProvider>;
}
