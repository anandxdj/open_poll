import type { Metadata, Viewport } from "next";
import { Instrument_Serif, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import GlobalClientLayout from "@/components/layouts/GlobalClientLayout";
import { getSiteUrl, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/seo/site";

// UI and display type.
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

// The one italic word a headline leans on; nothing else is set in it.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

// Join codes, counts, timers and other numbers.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Site-wide defaults; public pages add their own title, description and
// canonical URL with `pageMetadata` (lib/seo/site.ts), private ones `NO_INDEX`.
export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "live polls",
    "quiz",
    "audience response",
    "Q&A",
    "word cloud",
    "interactive presentation",
    "audience engagement",
  ],
  category: "productivity",
  icons: {
    icon: [{ url: "/logo-openpoll.svg", type: "image/svg+xml" }],
    shortcut: "/logo-openpoll.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  // Browser chrome takes the page colour: paper in light, warm graphite in dark.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // globals.css smooths in-page scrolling; this keeps route changes (a footer link to /login) instant.
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={cn("h-full antialiased", interTight.variable, instrumentSerif.variable, jetbrainsMono.variable)}
    >
      <body className="min-h-dvh flex flex-col bg-background text-foreground" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <GlobalClientLayout>
            {children}
          </GlobalClientLayout>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
