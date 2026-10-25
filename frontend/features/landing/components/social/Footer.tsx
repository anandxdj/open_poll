"use client";

import Link from "next/link";
import { ThemeSwitch } from "@/components/unlumen-ui/theme-switch";
import { BrandMark } from "../shared/BrandMark";
import { NAV_LINKS } from "../shared/nav-links";
import { container } from "../shared/styles";

const linkClass =
  "inline-flex min-h-10 items-center rounded-md text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const COLUMNS = [
  { title: "Product", links: NAV_LINKS.map((l) => ({ label: l.label, href: l.href })) },
  {
    title: "Get started",
    links: [
      { label: "Sign up free", href: "/signup" },
      { label: "Log in", href: "/login" },
      { label: "Join a session", href: "/live" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms of use", href: "/terms" },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="overflow-hidden border-t border-border">
      <div className={`${container} pt-14 md:pt-16`}>
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1.4fr_2fr] lg:gap-20">
          <div className="max-w-sm">
            <BrandMark />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Live polls, quizzes and Q&amp;A for the presentations you give.
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3">
            {COLUMNS.map((col) => (
              <div key={col.title}>
                <h2 className="text-sm font-semibold text-foreground">{col.title}</h2>
                <ul className="mt-3 flex flex-col">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={linkClass}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* The wordmark fills the column at every width (cqw = 1% of it); the link above already names the product. */}
        <div className="@container mt-16 md:mt-24">
          <p
            aria-hidden="true"
            className="select-none whitespace-nowrap pb-[0.2em] text-[length:24.6cqw] font-semibold leading-[0.8] tracking-[-0.06em] text-foreground"
          >
            Open Poll<span className="text-brand">.</span>
          </p>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4 border-t border-border py-6">
          <p className="text-sm text-muted-foreground">&copy; {year} Open Poll</p>
          <ThemeSwitch className="size-10 rounded-full md:size-9" />
        </div>
      </div>
    </footer>
  );
}
