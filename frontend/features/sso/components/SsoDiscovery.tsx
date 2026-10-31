"use client";

import { useState, type JSX, type SVGProps } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthField, authSecondaryClass } from "@/features/auth/components/fields";
import { getAuthLoginUrl } from "@/lib/env";
import { discoverSso } from "../api/sso.api";

/** The workspace sign-in URL for a discovered connection, with the email as a hint for the IdP. */
export const ssoLoginUrl = (loginUrl: string, email: string) => `${loginUrl}?email=${encodeURIComponent(email)}`;

/**
 * "Continue with SSO": asks for the work email, finds the workspace's
 * connection by its verified domain and goes there. Without one, it falls back
 * to the deployment-wide SSO provider, as the button always did.
 */
export function SsoDiscovery({ email: initialEmail, Icon }: { email: string; Icon: (props: JSX.IntrinsicAttributes & SVGProps<SVGSVGElement>) => JSX.Element }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" className={authSecondaryClass} onClick={() => setOpen(true)}>
        <Icon className="size-4" aria-hidden={true} />
        Continue with SSO
      </Button>
    );
  }

  return (
    <form
      aria-label="Sign in with single sign-on"
      className="space-y-3 rounded-lg border border-border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!email.includes("@")) return;
        setBusy(true);
        const found = await discoverSso(email.trim());
        window.location.assign(found ? ssoLoginUrl(found.loginUrl, email.trim()) : getAuthLoginUrl());
      }}
    >
      <AuthField
        type="email"
        id="sso-email"
        name="sso-email"
        label="Work email"
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
      />
      <Button type="submit" variant="outline" className={authSecondaryClass} disabled={busy || !email.includes("@")}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" aria-hidden={true} />}
        Continue with SSO
      </Button>
    </form>
  );
}
