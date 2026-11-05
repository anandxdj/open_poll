"use client";

import { useId, useState, type FormEvent } from "react";
import { MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseScreenLink, type ScreenLink } from "../screenLink";

/**
 * Asks for a screen link (Embed dialog → Stage for screens → Create screen
 * link) and hands back the deck and token. Only links to this site's stage
 * page are accepted.
 */
export function ScreenLinkForm({
  title,
  hint,
  submitLabel = "Show the stage",
  initial = "",
  onLink,
}: {
  title: string;
  hint: string;
  submitLabel?: string;
  initial?: string;
  onLink: (link: ScreenLink, url: string) => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const link = parseScreenLink(value, window.location.origin);
    if (!link) {
      setError(`Paste a screen link from this site: ${window.location.origin}/embed/stage/…`);
      return;
    }
    setError(null);
    onLink(link, value.trim());
  };

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 py-8 text-foreground">
      <div className="space-y-1.5">
        <MonitorPlay aria-hidden className="size-6 text-accent-ink" />
        <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Screen link
        </label>
        <Input
          id={id}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="https://…/embed/stage/…?token=scr_…"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="bg-card font-mono text-xs"
          autoComplete="off"
        />
        {error ? (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={!value.trim()}>
        {submitLabel}
      </Button>
      <p className="text-xs text-muted-foreground">
        Make one in Open Poll: the deck&apos;s menu → Embed → Stage for screens. Embedding must be on for the deck.
      </p>
    </form>
  );
}
