export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl animate-pulse px-4 py-7 sm:px-6 lg:px-10 lg:py-10" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded-lg bg-surface-3" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-surface-2" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface" />
        ))}
      </div>
      <div className="mt-6 h-72 rounded-2xl border border-border bg-surface" />
    </div>
  );
}
