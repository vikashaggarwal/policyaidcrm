"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { loginIdToEmail } from "@/lib/config";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const loginId = String(form.get("loginId") ?? "");
    const password = String(form.get("password") ?? "");
    if (!loginId.trim() || !password) {
      setError("Enter your login ID and password.");
      return;
    }
    setBusy(true);
    try {
      const { error: authError } = await createClient().auth.signInWithPassword({
        email: loginIdToEmail(loginId),
        password,
      });
      if (authError) {
        setError(
          authError.status && authError.status >= 500
            ? "We couldn't reach the server. Check your internet and try again."
            : "That login ID or password isn't right. Check both and try again.",
        );
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <div>
        <label htmlFor="loginId" className="mb-1 block text-sm font-medium">Login ID</label>
        <input
          id="loginId" name="loginId" className="field" autoComplete="username"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" required
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
        <input
          id="password" name="password" type="password" className="field"
          autoComplete="current-password" required
        />
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
      )}
      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
