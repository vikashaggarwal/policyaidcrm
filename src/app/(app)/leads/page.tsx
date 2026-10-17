import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { STATUS_LABEL } from "@/lib/outcomes";
import { createClient } from "@/lib/supabase/server";
import type { LeadStatus } from "@/lib/types";
import { ExportButtons } from "../export-buttons";
import { LeadsManager, type LeadItem } from "./leads-manager";
import { UnworkedPanel } from "./unworked-panel";

export const metadata: Metadata = { title: "Leads" };

const PAGE_SIZE = 50;
const STATUSES: LeadStatus[] = ["new", "no_answer", "message_sent", "callback", "interested", "sold", "not_interested", "wrong_number", "do_not_call"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

type SP = { assigned?: string; status?: string; q?: string; page?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requireProfile(["admin", "manager"]);
  const sp = await searchParams;

  const assigned = sp.assigned === "unassigned" || (sp.assigned && UUID.test(sp.assigned)) ? sp.assigned : "any";
  const status = STATUSES.includes(sp.status as LeadStatus) ? (sp.status as string) : "any";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1));

  const supabase = await createClient();
  const [list, callersRes, batches] = await Promise.all([
    supabase.rpc("staff_leads", {
      p_assigned: assigned, p_status: status, p_search: q || null, p_batch: null,
      p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE,
    }),
    supabase.from("profiles").select("id, full_name, active").eq("role", "caller").order("full_name"),
    supabase
      .from("upload_batches")
      .select("id, filename, total_rows, added, duplicates, invalid, created_at, finished_at, uploader:profiles!uploaded_by(full_name)")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const rows = (list.data ?? []) as (LeadItem & { total_count: number })[];
  const total = rows[0]?.total_count ?? 0;
  const callers = (callersRes.data ?? []) as { id: string; full_name: string; active: boolean }[];
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (p: number) => {
    const params = new URLSearchParams();
    if (assigned !== "any") params.set("assigned", assigned);
    if (status !== "any") params.set("status", status);
    if (q) params.set("q", q);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return `/leads${s ? `?${s}` : ""}`;
  };

  const filtersActive = assigned !== "any" || status !== "any" || q !== "";
  const exportParams: Record<string, string> = { assigned, status, q };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Leads</h1>
          <p className="text-sm text-muted">Find leads, move them between callers, and load new ones.</p>
        </div>
        <Link href="/leads/upload" className="btn btn-primary inline-flex items-center">Upload leads</Link>
      </header>

      <form action="/leads" className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
        <div>
          <label htmlFor="q" className="mb-1 block text-sm font-medium">Search</label>
          <input id="q" name="q" type="search" className="field" defaultValue={q} maxLength={60} placeholder="Name, number, city or reg. no." />
        </div>
        <div>
          <label htmlFor="assigned" className="mb-1 block text-sm font-medium">Assigned to</label>
          <select id="assigned" name="assigned" className="field" defaultValue={assigned}>
            <option value="any">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {callers.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.active ? "" : " (off)"}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-sm font-medium">Status</label>
          <select id="status" name="status" className="field" defaultValue={status}>
            <option value="any">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn btn-primary flex-1">Apply</button>
          {filtersActive && <Link href="/leads" className="btn inline-flex items-center">Clear</Link>}
        </div>
      </form>

      {list.error ? (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{friendlyError(list.error)} Refresh the page to try again.</p>
      ) : rows.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg font-semibold">{filtersActive ? "No leads match these filters" : "No leads yet"}</p>
          <p className="mt-1 text-muted">{filtersActive ? "Try clearing a filter." : "Upload a sheet to fill your callers' queues."}</p>
        </div>
      ) : (
        <LeadsManager
          key={`${assigned}|${status}|${q}|${page}`}
          rows={rows} total={total} page={page} pageSize={PAGE_SIZE}
          filters={{ assigned, status, q, batch: null }}
          callers={callers} isAdmin={me.role === "admin"}
          prevHref={page > 1 ? href(page - 1) : null} nextHref={page < lastPage ? href(page + 1) : null}
        />
      )}

      <section aria-labelledby="unworked" className="card space-y-3 p-4">
        <div>
          <h2 id="unworked" className="font-semibold">Reassign all unworked leads from a caller</h2>
          <p className="text-sm text-muted">Moves every lead that has never been called. Leads already worked stay with their caller.</p>
        </div>
        <UnworkedPanel callers={callers} />
      </section>

      <section aria-labelledby="exp" className="card space-y-3 p-4">
        <div>
          <h2 id="exp" className="font-semibold">Export leads</h2>
          <p className="text-sm text-muted">
            {filtersActive ? "Exports the leads matching the filters above." : "Exports every lead."} Exports are recorded in the audit log.
          </p>
        </div>
        <ExportButtons kind="leads" params={exportParams} label="Export leads" />
      </section>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-2 font-semibold">Recent uploads</h2>
        {(batches.data ?? []).length === 0 ? (
          <div className="card p-6 text-center">
            <p className="font-medium">No uploads yet</p>
            <p className="mt-1 text-sm text-muted">Your uploads and what happened to every row will be listed here.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {(batches.data ?? []).map((b) => {
              const uploader = (Array.isArray(b.uploader) ? b.uploader[0] : b.uploader) as { full_name: string } | null;
              return (
                <li key={b.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold">{b.filename}</p>
                    {!b.finished_at && <span className="shrink-0 rounded-full bg-warn-bg px-2.5 py-1 text-xs font-medium">Not finished</span>}
                  </div>
                  <p className="text-sm text-muted">{when.format(new Date(b.created_at))}{uploader ? ` · ${uploader.full_name}` : ""}</p>
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
        )}
      </section>
    </div>
  );
}
