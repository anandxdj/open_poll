import { QRCodeSVG } from "qrcode.react";
import { Smartphone } from "lucide-react";
import { MockFrame, MockHeader, SampleBadge } from "./MockFrame";

/** Showcase illustration: the join screen the audience sees on the big screen, and the phone side. */
export function SharePollMockup() {
  return (
    <MockFrame label="Illustration of the join screen: a QR code and the join code 482913 on the big screen, and a phone asking for a nickname.">
      <MockHeader icon={<Smartphone className="size-[18px]" />} title="Join the session" badge={<SampleBadge />} />

      <div className="mt-5 grid items-center gap-5 sm:grid-cols-[auto_1fr]">
        {/* White tile so the code stays scannable on both themes */}
        <div className="mx-auto rounded-2xl bg-white p-3 shadow-sm sm:mx-0">
          <QRCodeSVG value="Open Poll sample session" size={132} level="M" />
        </div>
        <div className="text-center sm:text-left">
          <p className="text-sm text-muted-foreground">Scan, or enter the code</p>
          <p className="mt-1 font-mono text-4xl font-semibold tracking-[0.2em] text-foreground">482913</p>
          <p className="mt-2 text-sm text-muted-foreground">No account needed to join.</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-background/60 p-4">
        <p className="text-sm font-semibold text-foreground">On the phone</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-field-border bg-card px-3.5 text-base text-foreground">
            Sam
          </div>
          <span className="inline-flex h-11 shrink-0 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground">
            Join
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Pick a nickname and you are in the lobby.</p>
      </div>
    </MockFrame>
  );
}
