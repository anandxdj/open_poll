import { QRCodeSVG } from "qrcode.react";
import { Smartphone } from "lucide-react";
import { MockFrame } from "./MockFrame";

/** Showcase illustration: the join screen on the big screen, and the phone side. */
export function SharePollMockup() {
  return (
    <MockFrame
      label="Illustration of the join screen: a QR code and the join code 482913 on the big screen, and a phone asking for a nickname."
      icon={<Smartphone />}
      title="Join the session"
    >
      <div className="grid items-center gap-5 sm:grid-cols-[auto_1fr]">
        {/* White tile so the code stays scannable on both themes */}
        <div className="mx-auto rounded-lg border border-border bg-white p-3 sm:mx-0">
          <QRCodeSVG value="Open Poll sample session" size={120} level="M" />
        </div>
        <div className="text-center sm:text-left">
          <p className="text-sm text-muted-foreground">Scan, or enter the code</p>
          <p className="mt-1 font-mono text-4xl font-semibold tracking-[0.14em] text-foreground">482 913</p>
          <p className="mt-2 text-sm text-muted-foreground">No account needed to join.</p>
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <p className="text-sm font-medium text-foreground">On the phone</p>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-input bg-background px-3 text-sm text-foreground">
            Sam
          </div>
          <span className="inline-flex h-10 shrink-0 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Join
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Pick a nickname and you are in the lobby.</p>
      </div>
    </MockFrame>
  );
}
