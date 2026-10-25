import { SettingsNav } from "@/features/workspaces/components/SettingsNav";

// Shared shell of every /settings/<section> page. The nav lists every section
// (features/workspaces/settings/sections.ts); each page renders only its content.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <header>
        <h1 className="text-4xl font-semibold leading-none tracking-[-0.04em] sm:text-5xl">Settings</h1>
        <p className="mt-3 text-base text-muted-foreground">Your account, this workspace and app preferences.</p>
      </header>

      <div className="mt-8 grid gap-8 md:mt-10 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
        <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
          <SettingsNav />
        </aside>
        <div className="min-w-0 max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
