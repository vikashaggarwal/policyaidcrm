import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";

export const metadata: Metadata = { title: "Queue" };

export default async function QueuePage() {
  await requireProfile(["caller"]);
  return (
    <section className="card p-6 text-center">
      <h1 className="text-lg font-bold">Your call queue</h1>
      <p className="mt-1 text-muted">Your leads will appear here once the queue goes live.</p>
    </section>
  );
}
