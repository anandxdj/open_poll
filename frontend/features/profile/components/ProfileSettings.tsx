"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore, type User } from "@/features/auth/store/useAuthStore";
import { SettingsHeading, SettingsRow, settingsCard, settingsList } from "@/features/workspaces/settings/blocks";
import { useMounted } from "@/hooks/use-mounted";
import { getApiErrorMessage } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { NAME_MAX_LENGTH, nameProblem, signInMethod } from "../account";
import { updateProfile } from "../api/profile.api";
import { ChangePasswordForm } from "./ChangePasswordForm";

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

/** The name field and its Save; the auth store (sidebar, Home greeting) follows the saved name. */
function NameForm({ user }: { user: User }) {
  const setUser = useAuthStore((s) => s.setUser);
  const [name, setName] = useState(user.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== user.name;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const problem = nameProblem(name);
    setError(problem);
    if (problem || !dirty) return;
    setSaving(true);
    try {
      const updated = await updateProfile({ name: name.trim() });
      setUser({ ...user, ...updated });
      setName(updated.name);
      toast.success("Name saved");
    } catch (err) {
      setError(getApiErrorMessage(err) ?? "Your name could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate className="w-full space-y-2 sm:w-80">
      <div className="flex gap-2">
        <Input
          id="profile-name"
          name="name"
          autoComplete="name"
          value={name}
          maxLength={NAME_MAX_LENGTH}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "profile-name-error" : undefined}
          className="h-10"
        />
        <Button type="submit" disabled={saving || !dirty} aria-busy={saving || undefined} className="h-10 px-4">
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Save
        </Button>
      </div>
      {error ? (
        <p id="profile-name-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Accounts that sign in through Google or SSO: why there is no form, and how to get a password. */
function NoPasswordNote({ user }: { user: User }) {
  return (
    <div className={cn(settingsCard, "space-y-4")}>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Password</p>
        <p className="text-sm text-muted-foreground">
          You sign in with {signInMethod(user.identities)}, so this account has no password to change.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        To add one, request a link with Forgot password and choose a password from the email. If your organization
        manages how you sign in, your password stays with them.
      </p>
      <Link href="/forgot-password" className={cn(buttonVariants({ variant: "outline" }), "bg-card")}>
        Set a password by email
      </Link>
    </div>
  );
}

/**
 * /settings/profile: your name (editable) and email, the app theme, and your
 * password: change it with the current one, or, for accounts that sign in
 * through Google or SSO, how to get one.
 */
export function ProfileSettings() {
  const { theme, setTheme } = useTheme();
  const user = useAuthStore((s) => s.user);
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
          <SettingsRow label="Full name" htmlFor="profile-name" description="Shown in the sidebar, on Home and to your teammates.">
            {/* Keyed by the stored name so the field follows a change made elsewhere. */}
            {user ? <NameForm key={`${user._id}:${user.name}`} user={user} /> : null}
          </SettingsRow>
          <SettingsRow label="Email" description="The address you sign in with. It can't be changed here.">
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
        <SettingsHeading
          id="security-title"
          title="Security"
          description="Changing your password signs you out on every other device."
        />
        {user?.hasPassword === false ? (
          <NoPasswordNote user={user} />
        ) : (
          <div className={settingsCard}>
            <h3 className="mb-5 text-base font-semibold tracking-[-0.01em] text-foreground">Change password</h3>
            <ChangePasswordForm />
          </div>
        )}
      </section>
    </div>
  );
}
