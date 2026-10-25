import { SettingsNav } from "@/features/workspaces/components/SettingsNav";

// Shared shell of every /settings/<section> page. The nav lists every section
// (features/workspaces/settings/sections.ts); each page renders only its content.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 md:px-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground/90">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account, your workspace and app preferences.</p>
      </header>

      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <aside>
          <SettingsNav />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
