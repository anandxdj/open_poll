import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground px-6 py-16">
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Privacy
        </h1>
        <p className="text-sm text-white/55 leading-relaxed">
          This page is a placeholder. Replace with your full privacy policy before
          production. We describe here only that Open Poll may collect usage data
          needed to run polls and analytics you configure.
        </p>
        <Link
          href="/"
          className="inline-flex text-sm font-medium text-yellow-400 hover:text-yellow-300 transition-colors duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        >
          ← Back home
        </Link>
      </div>
    </div>
  );
}
