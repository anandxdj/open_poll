"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { User, Palette, Shield, Bell, AppWindow } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const ease = [0.32, 0.72, 0, 1] as const;

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const sections = [
    { id: "profile", label: "Profile", icon: User },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "security", label: "Security", icon: Shield },
  ];

  if (!mounted) return null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground/90">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and app preferences.</p>
      </header>

      <div className="grid gap-8 md:grid-cols-[200px_1fr]">
        <aside className="space-y-1">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                const el = document.getElementById(s.id);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-secondary/50 hover:text-foreground"
            >
              <s.icon className="size-4" />
              {s.label}
            </button>
          ))}
        </aside>

        <main className="space-y-12">
          {/* Profile Section */}
          <section id="profile" className="scroll-mt-20 space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-foreground/90">Profile</h2>
              <p className="text-sm text-muted-foreground">Manage your public information.</p>
            </div>
            <div className="rounded-[1.5rem] border border-border bg-card p-6 space-y-6">
              <div className="flex items-center gap-4">
                <div className="size-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary text-xl font-bold">
                  JD
                </div>
                <div>
                  <p className="font-bold text-foreground/90">John Doe</p>
                  <p className="text-xs text-muted-foreground">john.doe@example.com</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground/60 cursor-not-allowed">
                    John
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground/60 cursor-not-allowed">
                    Doe
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
                  onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
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
        </main>
      </div>
    </div>
  );
}
