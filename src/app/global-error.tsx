"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 420, margin: "20vh auto" }}>
        <h1 style={{ fontSize: 20 }}>Dial Desk couldn&apos;t load</h1>
        <p>Something went wrong on our side. Please try again.</p>
        <button onClick={reset} style={{ minHeight: 48, padding: "0 18px", fontWeight: 600 }}>Try again</button>
      </body>
    </html>
  );
}
