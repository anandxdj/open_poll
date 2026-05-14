import type { Metadata } from "next";
import { Geist, Geist_Mono, Amethysta } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import GlobalClientLayout from "@/components/layouts/GlobalClientLayout";

const amethystaAmethysta = Amethysta({subsets:['latin'],weight:['400'],variable:'--font-amethysta'});

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Open Poll — Real-Time Polling Platform",
    template: "%s | Open Poll",
  },
  description:
    "Create beautiful, real-time polls powered by AI. Engage your audience with interactive questions and live analytics.",
  keywords: ["polling", "real-time", "survey", "audience", "analytics", "AI"],
  openGraph: {
    title: "Open Poll — Real-Time Polling Platform",
    description: "Create beautiful, real-time polls powered by AI.",
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
      suppressHydrationWarning
      className={cn("h-full antialiased", geistSans.variable, geistMono.variable, amethystaAmethysta.variable)}
    >
      <body className="min-h-dvh flex flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
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
