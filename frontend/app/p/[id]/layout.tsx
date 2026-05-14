export default function PublicPollLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-background px-4 py-10 text-foreground md:flex md:items-center md:justify-center md:py-16">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </div>
  );
}
