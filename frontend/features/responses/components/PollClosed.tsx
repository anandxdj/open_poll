import Link from "next/link";
import { Clock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PublicPageShell } from "@/features/landing/components/shared/PublicPageShell";
import { cn } from "@/lib/utils";

/** A poll link that can't take answers: closed, expired, unpublished or not a poll at all. */
export function PollClosed({
  title,
  hint = "This poll has ended or isn't taking answers right now.",
}: {
  title: string;
  hint?: string;
}) {
  return (
    <PublicPageShell label="Poll" footer={{ note: "Made with Open Poll", cta: "Make your own poll" }}>
      <div className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Clock className="size-6" aria-hidden />
        </span>
        <h1 className="mt-5 text-balance text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
        <p className="mt-2 text-base text-muted-foreground">{hint}</p>
        <Link href="/" className={cn(buttonVariants({ variant: "outline" }), "mt-6 bg-card")}>
          Go to Open Poll
        </Link>
      </div>
    </PublicPageShell>
  );
}
