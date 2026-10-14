"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/outcomes";
import type { LeadStatus } from "@/lib/types";
import { deleteLeads, reassignLeads, selectAllMatching } from "./actions";

export type LeadItem = {
  id: string; name: string; phone: string; reg_no: string | null; vehicle_make: string | null; vehicle_model: string | null;
  status: LeadStatus; assigned_name: string | null; dnd: boolean;
};
type Caller = { id: string; full_name: string; active: boolean };
type Filters = { assigned: string; status: string; q: string; batch: null };

const MAX_BULK = 5000;

export function LeadsManager({
  rows, total, page, pageSize, filters, callers, isAdmin, prevHref, nextHref,
}: {
  rows: LeadItem[]; total: number; page: number; pageSize: number; filters: Filters; callers: Caller[];
  isAdmin: boolean; prevHref: string | null; nextHref: string | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<string>("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const confirm = useRef<HTMLDialogElement>(null);

  const activeCallers = callers.filter((c) => c.active);
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const from = (page - 1) * pageSize + 1;

  const toggle = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function togglePage() {
    setSelected((s) => {
      const n = new Set(s);
      if (allOnPage) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id));
      return n;
    });
  }

  function selectEverything() {
    start(async () => {
      const res = await selectAllMatching(filters);
      if (!res.ok) { setNotice({ ok: false, text: res.message }); return; }
      setSelected(new Set(res.ids));
      setNotice(
        total > MAX_BULK
          ? { ok: true, text: `Selected the first ${MAX_BULK.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} matching leads. Bulk actions take up to ${MAX_BULK.toLocaleString("en-IN")} at a time.` }
          : null,
      );
    });
  }

  function reassign() {
    if (target === "") { setNotice({ ok: false, text: "Choose who should get these leads." }); return; }
    start(async () => {
      const res = await reassignLeads([...selected], target === "unassign" ? null : target);
      setNotice({ ok: res.ok, text: res.ok ? res.message : res.message });
      if (res.ok) { setSelected(new Set()); router.refresh(); }
    });
  }

  function doDelete() {
    confirm.current?.close();
    start(async () => {
      const res = await deleteLeads([...selected]);
      setNotice({ ok: res.ok, text: res.message });
      if (res.ok) { setSelected(new Set()); router.refresh(); }
    });
  }

  return (
    <section aria-label="Leads" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" aria-live="polite">
          Showing {from.toLocaleString("en-IN")}–{(from + rows.length - 1).toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
        </p>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="size-5" checked={allOnPage} onChange={togglePage} />
          Select this page
        </label>
      </div>

      {total > rows.length && selected.size > 0 && selected.size < Math.min(total, MAX_BULK) && (
        <button type="button" className="btn w-full" disabled={pending} onClick={selectEverything}>
          Select all {Math.min(total, MAX_BULK).toLocaleString("en-IN")} matching these filters
          {total > MAX_BULK ? " (the most one action can take)" : ""}
        </button>
      )}

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <label className={`card flex min-h-[76px] cursor-pointer items-center gap-3 p-3 ${selected.has(r.id) ? "ring-2 ring-primary" : ""}`}>
              <input type="checkbox" className="size-6 shrink-0" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.name}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.name}</span>
                <span className="block truncate text-sm text-muted">{[r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ") || "—"}</span>
                <span className="block text-sm text-muted">{r.reg_no ? `${r.reg_no} · ` : ""}{r.phone}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 text-right">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                <span className="max-w-28 truncate text-xs text-muted">{r.assigned_name ?? "Unassigned"}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      <nav aria-label="Pages" className="flex items-center justify-between gap-3">
        {prevHref ? <Link href={prevHref} className="btn inline-flex items-center">← Previous</Link> : <span />}
        <span className="text-sm text-muted">Page {page.toLocaleString("en-IN")}</span>
        {nextHref ? <Link href={nextHref} className="btn inline-flex items-center">Next →</Link> : <span />}
      </nav>

      <div aria-live="polite">
        {notice && (
          <p role={notice.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${notice.ok ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}>
            {notice.text}
          </p>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-line bg-surface p-4 shadow-[0_-4px_12px_rgb(0_0_0/0.08)]">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{selected.size.toLocaleString("en-IN")} selected</p>
            <button type="button" className="text-sm underline" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
          <label htmlFor="target" className="sr-only">Give selected leads to</label>
          <select id="target" className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Give to…</option>
            <option value="unassign">Nobody (unassign)</option>
            {activeCallers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1" disabled={pending || target === ""} onClick={reassign}>
              {pending ? "Working…" : "Reassign"}
            </button>
            {isAdmin && (
              <button type="button" className="btn btn-danger" disabled={pending} onClick={() => confirm.current?.showModal()}>Delete</button>
            )}
          </div>
        </div>
      )}

      <dialog ref={confirm} className="sheet" aria-labelledby="del-title">
        <div className="space-y-4 p-5">
          <h2 id="del-title" className="text-lg font-bold">Delete {selected.size.toLocaleString("en-IN")} {selected.size === 1 ? "lead" : "leads"}?</h2>
          <p className="text-muted">
            This permanently removes the leads <strong>and their call history</strong>. It can&apos;t be undone. The deletion is recorded in the audit log.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="btn" onClick={() => confirm.current?.close()}>Cancel</button>
            <button type="button" className="btn !border-transparent !bg-danger !text-bg" onClick={doDelete}>Delete permanently</button>
          </div>
        </div>
      </dialog>
    </section>
  );
}
