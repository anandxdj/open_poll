import type { Metadata } from "next";
import { Instrument_Serif, Inter_Tight, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import GlobalClientLayout from "@/components/layouts/GlobalClientLayout";

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

export const metadata: Metadata = {
  title: {
    default: "Open Poll — Live polls, quizzes and Q&A",
    template: "%s | Open Poll",
  },
  description:
    "Build decks of polls, quizzes, word clouds and Q&A, or draft one with AI. Your audience joins with a code and answers live.",
  keywords: ["live polls", "quiz", "audience response", "Q&A", "word cloud", "presentation"],
  icons: {
    icon: [{ url: "/logo-openpoll.svg", type: "image/svg+xml" }],
    shortcut: "/logo-openpoll.svg",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Open Poll — Live polls, quizzes and Q&A",
    description: "Live polls, quizzes and Q&A for presentations. Your audience joins with a code.",
    type: "website",
  },
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
