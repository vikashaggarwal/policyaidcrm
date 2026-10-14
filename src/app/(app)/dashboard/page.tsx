import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  await requireProfile(["admin", "manager"]);
  return (
    <section className="card p-6 text-center">
      <h1 className="text-lg font-bold">Dashboard</h1>
      <p className="mt-1 text-muted">Pipeline and caller performance will appear here.</p>
    </section>
  );
}
