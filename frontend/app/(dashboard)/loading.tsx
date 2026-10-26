/** While a creator page's code loads: the page header and a block in their final places. */
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:px-8">
      <div className="h-10 w-64 max-w-full animate-pulse rounded-lg bg-muted sm:h-12" />
      <div className="mt-4 h-5 w-80 max-w-full animate-pulse rounded bg-muted" />
      <div className="mt-8 h-24 animate-pulse rounded-xl bg-muted" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((key) => (
          <div key={key} className="h-48 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
