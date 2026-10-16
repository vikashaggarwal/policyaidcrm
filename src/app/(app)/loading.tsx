export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <h1 className="sr-only">Loading…</h1>
      <div className="h-8 w-40 animate-pulse rounded-lg bg-line" />
      {[0, 1, 2].map((i) => <div key={i} className="card h-24 animate-pulse" />)}
    </div>
  );
}
