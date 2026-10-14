import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Leads" };

const when = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
});

export default async function LeadsPage() {
  await requireProfile(["admin", "manager"]);
  const supabase = await createClient();
  const { data: batches, error } = await supabase
    .from("upload_batches")
    .select("id, filename, total_rows, added, duplicates, invalid, created_at, finished_at, uploader:profiles!uploaded_by(full_name)")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Leads</h1>
          <p className="text-sm text-muted">Load new leads and review recent uploads.</p>
        </div>
        <Link href="/leads/upload" className="btn btn-primary inline-flex items-center">Upload leads</Link>
      </header>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-2 font-semibold">Recent uploads</h2>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            We couldn&apos;t load recent uploads. Refresh to try again.
          </p>
        )}
        {!error && (batches ?? []).length === 0 && (
          <div className="card p-6 text-center">
            <p className="font-medium">No uploads yet</p>
            <p className="mt-1 text-sm text-muted">Upload your first sheet to start filling callers&apos; queues.</p>
          </div>
        )}
        <ul className="space-y-3">
          {(batches ?? []).map((b) => {
            const uploader = (Array.isArray(b.uploader) ? b.uploader[0] : b.uploader) as { full_name: string } | null;
            return (
              <li key={b.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate font-semibold">{b.filename}</p>
                  {!b.finished_at && (
                    <span className="shrink-0 rounded-full bg-warn-bg px-2.5 py-1 text-xs font-medium">Not finished</span>
                  )}
                </div>
                <p className="text-sm text-muted">
                  {when.format(new Date(b.created_at))}{uploader ? ` · ${uploader.full_name}` : ""}
                </p>
                <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-sm">
                  {[["Rows", b.total_rows], ["Added", b.added], ["Duplicates", b.duplicates], ["Invalid", b.invalid]].map(([k, v]) => (
                    <div key={k as string}>
                      <dd className="text-lg font-bold">{(v as number).toLocaleString("en-IN")}</dd>
                      <dt className="text-xs text-muted">{k}</dt>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
