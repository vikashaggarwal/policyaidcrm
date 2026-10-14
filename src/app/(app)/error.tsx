"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The raw error is never shown: it can contain internals. It is still in the server logs.
  return (
    <div role="alert" className="card space-y-3 p-6 text-center">
      <h1 className="text-lg font-bold">That didn&apos;t load</h1>
      <p className="text-muted">Something went wrong on our side. Your work is safe. Try again, and if it keeps happening tell your manager.</p>
      <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
    </div>
  );
}
