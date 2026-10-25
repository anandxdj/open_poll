"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/features/auth";
import { useMounted } from "@/hooks/use-mounted";

function applyWithTransition(
  origin: { x: number; y: number },
  apply: () => void,
) {
  if (!document.startViewTransition) {
    apply();
    return;
  }

  // Fallback to center if coordinates are missing or zero (keyboard activation)
  const x = origin.x || window.innerWidth / 2;
  const y = origin.y || window.innerHeight / 2;

  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  document.documentElement.style.setProperty("--vt-x", `${x}px`);
  document.documentElement.style.setProperty("--vt-y", `${y}px`);
  document.documentElement.style.setProperty("--vt-r", `${endRadius}px`);
  document.startViewTransition(apply);
}

export default function ProfileSettingsPage() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuthStore();
  const mounted = useMounted();
  const [imgError, setImgError] = useState(false);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .substring(0, 2);
  };

  if (!mounted) return null;

  return (
    <div className="space-y-12">
      {/* Profile Section */}
      <section id="profile" className="scroll-mt-20 space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground/90">Profile</h2>
          <p className="text-sm text-muted-foreground">Manage your public information.</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card p-6 space-y-6">
          <div className="flex items-center gap-4">
            <div className="size-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xl font-bold overflow-hidden">
              {user?.picture && !imgError ? (
                <img
                  src={user.picture}
                  alt=""
                  className="size-full object-cover"
                  onError={() => setImgError(true)}
                />
              ) : (
                getInitials(user?.name || "User")
              )}
            </div>
            <div>
              <p className="font-bold text-foreground/90">{user?.name || "User"}</p>
              <p className="text-xs text-muted-foreground">{user?.email || "Account"}</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="firstName">Full Name</Label>
              <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground/60 cursor-not-allowed">
                {user?.name || "User"}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground/60 cursor-not-allowed">
                {user?.email || "Account"}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Appearance Section */}
      <section id="appearance" className="scroll-mt-20 space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground/90">Appearance</h2>
          <p className="text-sm text-muted-foreground">Customize the look and feel of the app.</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-bold">Dark Mode</Label>
              <p className="text-xs text-muted-foreground">Switch between light and dark themes.</p>
            </div>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={() => {}}
              onClick={(e) => {
                const origin = { x: e.clientX, y: e.clientY };
                const next = theme === "dark" ? "light" : "dark";
                applyWithTransition(origin, () => setTheme(next));
              }}
            />
          </div>
        </div>
      </section>

      {/* Notifications Section */}
      <section id="notifications" className="scroll-mt-20 space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground/90">Notifications</h2>
          <p className="text-sm text-muted-foreground">Configure how you receive alerts.</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Email Notifications</Label>
            <Switch defaultChecked />
          </div>
          <div className="h-px bg-border/50" />
          <div className="flex items-center justify-between">
            <Label className="text-sm">Browser Push</Label>
            <Switch />
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section id="security" className="scroll-mt-20 space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-foreground/90">Security</h2>
          <p className="text-sm text-muted-foreground">Protect your account data.</p>
        </div>
        <div className="rounded-[1.5rem] border border-border bg-card p-6">
          <button className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:opacity-90">
            Change Password
          </button>
        </div>
      </section>
    </div>
  );
}
