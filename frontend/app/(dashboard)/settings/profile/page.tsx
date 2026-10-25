"use client";

import { useState } from "react";
import Link from "next/link";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { buttonVariants } from "@/components/ui/button";
import { useAuthStore } from "@/features/auth";
import { SettingsHeading, SettingsRow, settingsList } from "@/features/workspaces/settings/blocks";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

function applyWithTransition(origin: { x: number; y: number }, apply: () => void) {
  if (!document.startViewTransition) {
    apply();
    return;
  }

  // Fallback to center if coordinates are missing or zero (keyboard activation)
  const x = origin.x || window.innerWidth / 2;
  const y = origin.y || window.innerHeight / 2;

  const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  document.documentElement.style.setProperty("--vt-x", `${x}px`);
  document.documentElement.style.setProperty("--vt-y", `${y}px`);
  document.documentElement.style.setProperty("--vt-r", `${endRadius}px`);
  document.startViewTransition(apply);
}

const THEMES = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .substring(0, 2);

/**
 * /settings/profile: who you are, the app theme and your password. Name and
 * email are read-only (there is no profile update API); the password is reset
 * by email through the forgot-password flow.
 */
export default function ProfileSettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuthStore();
  const mounted = useMounted();
  const [imgError, setImgError] = useState(false);

  if (!mounted) return null;

  return (
    <div className="space-y-12">
      <section id="profile" aria-labelledby="profile-title" className="scroll-mt-20 space-y-5">
        <SettingsHeading id="profile-title" title="Profile" description="How you appear to the people you work with." />
        <div className={settingsList}>
          <div className="flex items-center gap-4 px-5 py-5 sm:px-6">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary font-mono text-base font-medium text-foreground">
              {user?.picture && !imgError ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.picture} alt="" className="size-full object-cover" onError={() => setImgError(true)} />
              ) : (
                initials(user?.name || "User")
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold tracking-[-0.02em]">{user?.name || "Your account"}</p>
              <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <SettingsRow label="Full name">
            <span className="text-sm text-muted-foreground">{user?.name || "Not set"}</span>
          </SettingsRow>
          <SettingsRow label="Email">
            <span className="text-sm text-muted-foreground">{user?.email || "Not set"}</span>
          </SettingsRow>
        </div>
      </section>

      <section id="appearance" aria-labelledby="appearance-title" className="scroll-mt-20 space-y-5">
        <SettingsHeading id="appearance-title" title="Appearance" description="Applies on this device." />
        <div className={settingsList}>
          <SettingsRow label="Theme" description="System follows your device's light or dark setting.">
            <div role="group" aria-label="Theme" className="inline-flex rounded-lg border border-border bg-secondary p-0.5">
              {THEMES.map(({ value, label, Icon }) => {
                const selected = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={(e) => applyWithTransition({ x: e.clientX, y: e.clientY }, () => setTheme(value))}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring",
                      selected ? "bg-card text-foreground shadow-[0_1px_2px_rgb(23_23_23/0.08)]" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className={cn("size-4", selected && "text-accent-ink")} />
                    {label}
                  </button>
                );
              })}
            </div>
          </SettingsRow>
        </div>
      </section>

      <section id="security" aria-labelledby="security-title" className="scroll-mt-20 space-y-5">
        <SettingsHeading id="security-title" title="Security" description="Keep your account safe." />
        <div className={settingsList}>
          <SettingsRow label="Password" description="We email you a link to set a new one.">
            <Link href="/forgot-password" className={cn(buttonVariants({ variant: "outline" }), "bg-card")}>
              Reset password
            </Link>
          </SettingsRow>
        </div>
      </section>
    </div>
  );
}
