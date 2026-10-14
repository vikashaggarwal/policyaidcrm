import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { AUDIT_GROUPS, describeAudit, type AuditEntry } from "@/lib/audit";
import { friendlyError } from "@/lib/errors";
import { formatIst } from "@/lib/time";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit" };

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  await requireProfile(["admin", "manager"]);
  const sp = await searchParams;
  const group = AUDIT_GROUPS.find((g) => g.value === sp.show) ?? null;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? "1", 10) || 1));

  const supabase = await createClient();
  let query = supabase
    .from("audit_log")
    .select("id, actor_id, action, entity, entity_id, details, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (group) query = query.in("action", group.actions);

  const [{ data, count, error }, people] = await Promise.all([query, supabase.from("profiles").select("id, full_name")]);
  const names = new Map((people.data ?? []).map((p) => [p.id as string, p.full_name as string]));
  const entries = (data ?? []) as AuditEntry[];
  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const href = (g: string | null, p = 1) => {
    const params = new URLSearchParams();
    if (g) params.set("show", g);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return `/audit${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold">Audit trail</h1>
        <p className="text-sm text-muted">Who did what, and when. Entries can&apos;t be edited or deleted by anyone.</p>
      </header>

      <nav aria-label="Filter audit entries" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[{ value: null, label: "Everything" }, ...AUDIT_GROUPS].map((g) => {
          const on = (g.value ?? null) === (group?.value ?? null);
          return (
            <Link
              key={g.label} href={href(g.value)} aria-current={on ? "true" : undefined}
              className={`flex min-h-12 shrink-0 items-center rounded-full border px-4 text-sm font-medium ${on ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface"}`}
            >
              {g.label}
            </Link>
          );
        })}
      </nav>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{friendlyError(error)} Refresh the page to try again.</p>
      ) : entries.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-lg font-semibold">Nothing recorded yet</p>
          <p className="mt-1 text-muted">Uploads, reassignments, deletions and exports will appear here.</p>
        </div>
      ) : (
        <>
          <ol className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="card p-3">
                <p className="break-words">{describeAudit(e, names)}</p>
                <p className="mt-1 text-sm text-muted">
                  {e.actor_id ? names.get(e.actor_id) ?? "A removed user" : "System"} · <time dateTime={e.created_at}>{formatIst(e.created_at)}</time>
                </p>
              </li>
            ))}
          </ol>
          <nav aria-label="Pages" className="flex items-center justify-between gap-3">
            {page > 1 ? <Link href={href(group?.value ?? null, page - 1)} className="btn inline-flex items-center">← Newer</Link> : <span />}
            <span className="text-sm text-muted">Page {page} of {lastPage.toLocaleString("en-IN")}</span>
            {page < lastPage ? <Link href={href(group?.value ?? null, page + 1)} className="btn inline-flex items-center">Older →</Link> : <span />}
          </nav>
        </>
      )}
    </div>
  );
}
