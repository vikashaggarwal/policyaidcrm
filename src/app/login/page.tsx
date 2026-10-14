import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getProfile, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const profile = await getProfile();
  if (profile) redirect(homeFor(profile.role));
  const { reason } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-bold">Dial Desk</h1>
      <p className="mt-1 text-muted">Sign in with the login ID your admin gave you.</p>
      {reason === "signed_out" && (
        <p role="status" className="mt-4 rounded-lg bg-warn-bg px-3 py-2 text-sm">
          Your session ended or this account is switched off. Sign in again, or ask your admin.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
