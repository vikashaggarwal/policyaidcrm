import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsPage() {
  await requireProfile(["admin", "manager"]);
  return (
    <section className="card p-6 text-center">
      <h1 className="text-lg font-bold">Leads</h1>
      <p className="mt-1 text-muted">Upload and assign leads here.</p>
    </section>
  );
}
