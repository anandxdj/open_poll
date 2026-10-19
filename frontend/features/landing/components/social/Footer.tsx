import Link from "next/link";
import { BrandMark } from "../shared/BrandMark";
import { NAV_LINKS } from "../shared/nav-links";
import { container } from "../shared/styles";

const linkClass =
  "mk-focus inline-flex min-h-11 items-center rounded-sm text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground";

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
    <footer className="border-t border-border bg-secondary/30">
      <div className={`${container} py-14 sm:py-16`}>
        <div className="grid gap-12 md:grid-cols-[1.4fr_2fr] lg:gap-20">
          <div className="max-w-sm">
            <BrandMark />
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
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

        <p className="mt-14 border-t border-border pt-6 text-sm text-muted-foreground">
          &copy; {year} Open Poll
        </p>
      </div>
    </footer>
  );
}
