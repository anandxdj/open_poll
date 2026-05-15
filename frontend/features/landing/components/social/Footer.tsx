"use client";

import Link from "next/link";
import { Mail } from "lucide-react";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const TwitterIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
  </svg>
);
import { ProductLogo } from "@/components/ui/ProductLogo";

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border px-6 pt-20 pb-12 bg-secondary/[0.02] relative overflow-hidden">
      {/* Subtle Glow */}
      <div className="absolute -bottom-24 left-1/2 -translate-x-1/2 size-96 bg-primary/5 blur-[120px] rounded-full pointer-events-none" />

      <div className="max-w-7xl mx-auto space-y-16 relative">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-12 md:gap-8">
          {/* Brand Column */}
          <div className="col-span-2 space-y-6">
            <Link href="/" className="flex items-center gap-3 group w-fit">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-primary/20 blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <div className="relative size-8 flex items-center justify-center">
                  <ProductLogo size={32} />
                </div>
              </div>
              <span className="text-sm font-bold tracking-tight text-foreground/90">
                Open Poll
              </span>
            </Link>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              The modern standard for real-time interactive polling. 
              Build, share, and analyze with sub-millisecond latency.
            </p>
            <div className="flex items-center gap-4">
              {[
                { icon: TwitterIcon, href: "#", label: "Twitter" },
                { icon: GithubIcon, href: "#", label: "GitHub" },
                { icon: Mail, href: "#", label: "Email" },
              ].map((social) => (
                <Link
                  key={social.label}
                  href={social.href}
                  className="size-9 rounded-xl border border-border bg-background flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group"
                  aria-label={social.label}
                >
                  <social.icon className="size-4" />
                </Link>
              ))}
            </div>
          </div>

          {/* Links Columns */}
          <div className="space-y-6">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Product</h4>
            <nav className="flex flex-col gap-4">
              <Link href="/polls" className="text-sm text-muted-foreground hover:text-primary transition-colors">Dashboard</Link>
              <Link href="/create" className="text-sm text-muted-foreground hover:text-primary transition-colors">Create Poll</Link>
              <Link href="#features" className="text-sm text-muted-foreground hover:text-primary transition-colors">Features</Link>
            </nav>
          </div>

          <div className="space-y-6">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/50">Resources</h4>
            <nav className="flex flex-col gap-4">
              <Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="text-sm text-muted-foreground hover:text-primary transition-colors">Terms of Service</Link>
              <Link href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors">Help Center</Link>
            </nav>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-12 border-t border-border/50 flex flex-col md:flex-row items-center justify-between gap-6">
          <p className="text-xs text-muted-foreground/50 font-medium">
            © {currentYear} Open Poll. Built for speed and anonymity.
          </p>
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary/40" />
            <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">Global Infrastructure</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
