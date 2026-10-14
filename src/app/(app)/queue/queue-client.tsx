"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/outcomes";
import {
  FILTERS, PAGE_SIZE, type QueueCounts, type QueueFilter, type QueueRow,
} from "@/lib/queue-types";
import { describeCallback } from "@/lib/time";
import { fetchCounts, fetchQueue } from "./api";
import { AddLeadSheet } from "./add-lead-sheet";
import { LeadSheet } from "./lead-sheet";

const EMPTY_TEXT: Record<QueueFilter, [string, string]> = {
  todo: ["You're all caught up", "No leads need a call right now. New leads and callbacks will show up here."],
  due: ["No callbacks due", "Nothing is waiting for a call back at the moment."],
  new: ["No new leads", "Ask your manager for more leads when you're ready."],
  no_answer: ["No unanswered leads", "Leads that didn't pick up will wait here for another try."],
  callbacks: ["No upcoming callbacks", "Callbacks you schedule for later appear here."],
  interested: ["No interested leads waiting", "Leads that showed interest, with nothing scheduled, appear here."],
  closed: ["Nothing closed yet", "Sold and not-interested leads appear here."],
};

export function QueueClient({
  initialRows, initialCounts, initialError,
}: { initialRows: QueueRow[]; initialCounts: QueueCounts; initialError: string | null }) {
  const [filter, setFilter] = useState<QueueFilter>("todo");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialRows[0]?.total_count ?? 0);
  const [counts, setCounts] = useState(initialCounts);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [selected, setSelected] = useState<QueueRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const firstRun = useRef(true);
  const requestId = useRef(0);
  const listTop = useRef<HTMLDivElement>(null);

  // Debounce typing so we don't query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  /** Reload the list (and counts) from the top. `keep` re-fetches as many rows as are already on screen. */
  const reload = useCallback(async (f: QueueFilter, s: string, keep = 0, withSpinner = true) => {
    const id = ++requestId.current;
    if (withSpinner) setLoading(true);
    const [list, cnt] = await Promise.all([fetchQueue(f, s, Math.max(PAGE_SIZE, keep), 0), fetchCounts(s)]);
    if (id !== requestId.current) return; // a newer request replaced this one
    setLoading(false);
    if (!list.ok) { setError(list.message); return; }
    setError(null);
    setRows(list.data);
    setTotal(list.data[0]?.total_count ?? 0);
    if (cnt.ok) setCounts(cnt.data);
  }, []);

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; } // server already sent the first page
    void reload(filter, search);
  }, [filter, search, reload]);

  // Coming back to the app (phone unlocked, tab switched) refreshes what's due.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload(filter, search, rows.length, false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [filter, search, rows.length, reload]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function loadMore() {
    setLoadingMore(true);
    const res = await fetchQueue(filter, search, PAGE_SIZE, rows.length);
    setLoadingMore(false);
    if (!res.ok) { setError(res.message); return; }
    setRows((prev) => {
      const have = new Set(prev.map((r) => r.id));
      return [...prev, ...res.data.filter((r) => !have.has(r.id))];
    });
  }

  const [emptyTitle, emptyBody] = search
    ? ["No matches", "Try a name, a mobile number, a city or a registration number."]
    : EMPTY_TEXT[filter];

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Your call queue</h1>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="q" className="sr-only">Search leads</label>
          <input
            id="q" type="search" inputMode="search" className="field" placeholder="Search name, number, city…"
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)} autoComplete="off" maxLength={60}
          />
        </div>
        <button type="button" className="btn btn-primary shrink-0" onClick={() => setAdding(true)}>+ Add lead</button>
      </div>

      <div role="group" aria-label="Filter leads" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value} type="button" aria-pressed={filter === f.value}
            onClick={() => { setFilter(f.value); listTop.current?.scrollIntoView({ block: "nearest" }); }}
            className={`flex min-h-12 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium ${
              filter === f.value ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface"
            }`}
          >
            {f.label}
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              f.value === "due" && counts.due > 0 && filter !== "due" ? "bg-danger-bg text-danger" : "bg-black/10"
            }`}>
              {counts[f.value].toLocaleString("en-IN")}
            </span>
          </button>
        ))}
      </div>

      <div ref={listTop} aria-live="polite" aria-busy={loading}>
        {error && (
          <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            <span>{error}</span>
            <button type="button" className="btn !min-h-10 shrink-0 !px-3 text-sm" onClick={() => void reload(filter, search)}>Retry</button>
          </div>
        )}

        {loading && rows.length === 0 ? (
          <ul className="space-y-3" aria-label="Loading leads">
            {[0, 1, 2, 3].map((i) => <li key={i} className="card h-[84px] animate-pulse" />)}
          </ul>
        ) : rows.length === 0 && !error ? (
          <div className="card p-8 text-center">
            <p className="text-lg font-semibold">{emptyTitle}</p>
            <p className="mt-1 text-muted">{emptyBody}</p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted">
              {total.toLocaleString("en-IN")} {total === 1 ? "lead" : "leads"}
            </p>
            <ul className={`space-y-3 ${loading ? "opacity-60" : ""}`}>
              {rows.map((r) => <LeadCard key={r.id} row={r} onOpen={() => setSelected(r)} />)}
            </ul>
            {rows.length < total && (
              <button type="button" className="btn mt-4 w-full" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Loading…" : `Show more (${(total - rows.length).toLocaleString("en-IN")} left)`}
              </button>
            )}
          </>
        )}
      </div>

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-4 z-30 mx-auto max-w-md rounded-xl bg-ink px-4 py-3 text-center text-sm font-medium text-bg shadow-lg">
          {toast}
        </div>
      )}

      {adding && (
        <AddLeadSheet
          onClose={() => setAdding(false)}
          onAdded={(lead) => {
            setAdding(false);
            setToast(`Added ${lead.name}. It's in your queue.`);
            void reload(filter, search, rows.length, false);
            setSelected(lead); // open it straight away so the call can be logged
          }}
        />
      )}

      {selected && (
        <LeadSheet
          row={selected}
          onClose={() => setSelected(null)}
          onSaved={(message) => {
            setSelected(null);
            setToast(message);
            void reload(filter, search, rows.length, false);
          }}
        />
      )}
    </div>
  );
}

function LeadCard({ row, onOpen }: { row: QueueRow; onOpen: () => void }) {
  const cb = row.callback_at ? describeCallback(row.callback_at) : null;
  const vehicle = [row.vehicle_make, row.vehicle_model].filter(Boolean).join(" ");
  return (
    <li>
      <button
        type="button" onClick={onOpen}
        className="card flex min-h-[84px] w-full items-center justify-between gap-3 p-4 text-left active:bg-line/40"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold">{row.name}</span>
          <span className="block truncate text-sm text-muted">{vehicle || "Vehicle details not provided"}</span>
          <span className="block text-sm text-muted">{row.reg_no ? `${row.reg_no} · ` : ""}{row.phone}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[row.status]}`}>
            {STATUS_LABEL[row.status]}
          </span>
          {cb && (
            <span className={`text-xs font-medium ${cb.due ? "text-danger" : "text-muted"}`}>{cb.text}</span>
          )}
        </span>
      </button>
    </li>
  );
}
