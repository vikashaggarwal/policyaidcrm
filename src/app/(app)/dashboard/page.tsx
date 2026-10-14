import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { pct, STATUS_ORDER, type DashboardSummary } from "@/lib/dashboard";
import { friendlyError } from "@/lib/errors";
import { STATUS_LABEL } from "@/lib/outcomes";
import { resolveRange } from "@/lib/range";
import { createClient } from "@/lib/supabase/server";
import { ExportButtons } from "../export-buttons";

export const metadata: Metadata = { title: "Dashboard" };

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
] as const;

type SP = { range?: string; from?: string; to?: string };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireProfile(["admin", "manager"]);
  const sp = await searchParams;
  const range = resolveRange(sp.range ?? "7d", sp.from, sp.to);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_summary", { p_from: range.from, p_to: range.to });
  const s = data as DashboardSummary | null;

  const exportParams: Record<string, string> =
    range.preset === "custom" ? { range: "custom", from: range.fromDate ?? "", to: range.toDate ?? "" } : { range: range.preset };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <nav aria-label="Date range" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {PRESETS.map((p) => (
            <Link
              key={p.value} href={`/dashboard?range=${p.value}`} aria-current={range.preset === p.value ? "true" : undefined}
              className={`flex min-h-12 shrink-0 items-center rounded-full border px-4 text-sm font-medium ${
                range.preset === p.value ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <details className="card px-4" open={range.preset === "custom"}>
          <summary className="flex min-h-12 cursor-pointer items-center text-sm font-medium">Custom dates</summary>
          <form action="/dashboard" className="grid gap-3 pb-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="range" value="custom" />
            <div>
              <label htmlFor="from" className="mb-1 block text-sm font-medium">From</label>
              <input id="from" name="from" type="date" className="field" defaultValue={range.fromDate} required />
            </div>
            <div>
              <label htmlFor="to" className="mb-1 block text-sm font-medium">To (included)</label>
              <input id="to" name="to" type="date" className="field" defaultValue={range.toDate} required />
            </div>
            <button type="submit" className="btn btn-primary">Apply</button>
          </form>
        </details>
        {range.notice && <p role="status" className="rounded-lg bg-warn-bg px-3 py-2 text-sm">{range.notice}</p>}
        <p className="text-sm text-muted">
          <strong className="text-ink">{range.label}.</strong> Pipeline counts leads loaded in this period; caller figures count calls
          made in it. Callbacks due and overdue are always live.
        </p>
      </header>

      {error || !s ? (
        <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
          {friendlyError(error)} Refresh the page to try again.
        </p>
      ) : (
        <>
          <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Leads loaded" value={s.loaded.toLocaleString("en-IN")} note={s.unassigned_new > 0 ? `${s.unassigned_new.toLocaleString("en-IN")} unassigned (live)` : "All assigned"} />
            <Kpi label="Called at least once" value={s.called_once.toLocaleString("en-IN")} note={`${pct(s.called_once, s.loaded)} of loaded`} />
            <Kpi label="Callbacks due now" value={s.callbacks_due.toLocaleString("en-IN")} note="Live, not date-filtered" alert={s.callbacks_due > 0} />
            <Kpi label="Sold, of called" value={pct(s.sold, s.called_once)} note={`${s.sold.toLocaleString("en-IN")} sold of ${s.called_once.toLocaleString("en-IN")} called`} />
          </section>

          <PipelineBar summary={s} />
          <Callers summary={s} />

          <section aria-labelledby="exp" className="card space-y-3 p-4">
            <div>
              <h2 id="exp" className="font-semibold">Export call logs</h2>
              <p className="text-sm text-muted">Every call in {range.label.toLowerCase()}, with the caller, outcome and note. Exports are recorded in the audit log.</p>
            </div>
            <ExportButtons kind="call-logs" params={exportParams} label="Export call logs" />
          </section>

          <div className="flex flex-wrap gap-2">
            <Link href="/leads" className="btn inline-flex items-center">Manage and reassign leads</Link>
            <Link href="/leads/upload" className="btn inline-flex items-center">Upload leads</Link>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, note, alert }: { label: string; value: string; note: string; alert?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${alert ? "text-danger" : ""}`}>{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function PipelineBar({ summary }: { summary: DashboardSummary }) {
  const total = summary.loaded;
  const rows = STATUS_ORDER.map((st) => ({ st, n: summary.by_status[st] ?? 0 }));
  const description = rows.filter((r) => r.n > 0).map((r) => `${STATUS_LABEL[r.st]} ${r.n}`).join(", ");
  return (
    <section aria-labelledby="pipe" className="card space-y-3 p-4">
      <h2 id="pipe" className="font-semibold">Leads by status</h2>
      {total === 0 ? (
        <p className="text-sm text-muted">No leads were loaded in this period. Try a longer range, or upload leads.</p>
      ) : (
        <>
          <div role="img" aria-label={`Leads by status: ${description}`} className="flex h-8 overflow-hidden rounded-lg bg-line">
            {rows.filter((r) => r.n > 0).map((r) => (
              <div key={r.st} style={{ width: `${(r.n / total) * 100}%`, background: `var(--s-${r.st})` }} title={`${STATUS_LABEL[r.st]}: ${r.n}`} />
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            {rows.map((r) => (
              <li key={r.st} className="flex items-center gap-2">
                <span aria-hidden className="size-3 shrink-0 rounded-sm" style={{ background: `var(--s-${r.st})` }} />
                <span className="min-w-0 truncate">{STATUS_LABEL[r.st]}</span>
                <span className="ml-auto font-medium">{r.n.toLocaleString("en-IN")}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Callers({ summary }: { summary: DashboardSummary }) {
  const callers = summary.callers;
  return (
    <section aria-labelledby="callers" className="space-y-3">
      <h2 id="callers" className="font-semibold">Callers</h2>
      {callers.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-medium">No callers yet</p>
          <p className="mt-1 text-sm text-muted">Ask an admin to add callers under Users.</p>
        </div>
      ) : (
        <>
          {/* Phones: one card per caller */}
          <ul className="space-y-3 md:hidden">
            {callers.map((c) => (
              <li key={c.id} className="card p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate font-semibold">{c.name}{!c.active && <span className="ml-2 text-xs font-normal text-muted">(off)</span>}</p>
                  <Link href={`/leads?assigned=${c.id}`} className="shrink-0 text-sm text-primary underline">View leads</Link>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-3 text-center text-sm">
                  {([
                    ["Assigned", c.assigned], ["Called", c.called], ["Connected", c.connected],
                    ["Interested", c.interested], ["Sold", c.sold], ["Conversion", pct(c.sold, c.called)],
                  ] as const).map(([k, v]) => (
                    <div key={k}>
                      <dd className="text-lg font-bold">{typeof v === "number" ? v.toLocaleString("en-IN") : v}</dd>
                      <dt className="text-xs text-muted">{k}</dt>
                    </div>
                  ))}
                </dl>
                {c.overdue > 0 && (
                  <p className="mt-3 rounded-lg bg-danger-bg px-3 py-1.5 text-center text-sm font-medium text-danger">
                    {c.overdue.toLocaleString("en-IN")} callbacks overdue
                  </p>
                )}
              </li>
            ))}
          </ul>

          {/* Tablets and desktops: a real table */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Caller performance for the selected period</caption>
              <thead className="border-b border-line text-muted">
                <tr>
                  {["Caller", "Assigned", "Called", "Connected", "Interested", "Sold", "Conversion", "Callbacks overdue"].map((h, i) => (
                    <th key={h} scope="col" className={`px-4 py-3 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {callers.map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium">
                      <Link href={`/leads?assigned=${c.id}`} className="underline">{c.name}</Link>
                      {!c.active && <span className="ml-2 text-xs font-normal text-muted">(off)</span>}
                    </th>
                    <td className="px-4 py-3 text-right">{c.assigned.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right">{c.called.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right">{c.connected.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right">{c.interested.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right">{c.sold.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 text-right">{pct(c.sold, c.called)}</td>
                    <td className={`px-4 py-3 text-right ${c.overdue > 0 ? "font-semibold text-danger" : ""}`}>{c.overdue.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Called = different leads called. Connected = someone answered (anything except no answer). Conversion = sold ÷ called.
          </p>
        </>
      )}
    </section>
  );
}
