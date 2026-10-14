import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-bold">We couldn&apos;t find that page</h1>
      <p className="text-muted">The link may be old or mistyped.</p>
      <Link href="/" className="btn btn-primary inline-flex items-center justify-center">Go to your home page</Link>
    </main>
  );
}
