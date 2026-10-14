"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { countUnworked, reassignUnworked } from "./actions";

type Caller = { id: string; full_name: string; active: boolean };

export function UnworkedPanel({ callers }: { callers: Caller[] }) {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const targets = callers.filter((c) => c.active && c.id !== from);

  function check() {
    setNotice(null); setCount(null);
    start(async () => {
      const res = await countUnworked(from);
      if (!res.ok) setNotice({ ok: false, text: res.message }); else setCount(res.count);
    });
  }

  function move() {
    start(async () => {
      const res = await reassignUnworked(from, to === "unassign" ? null : to);
      setNotice({ ok: res.ok, text: res.message });
      if (res.ok) { setCount(null); setFrom(""); setTo(""); router.refresh(); }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="uw-from" className="mb-1 block text-sm font-medium">Take from</label>
          <select id="uw-from" className="field" value={from} onChange={(e) => { setFrom(e.target.value); setCount(null); setTo(""); setNotice(null); }}>
            <option value="">Choose a caller…</option>
            {callers.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.active ? "" : " (off)"}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="uw-to" className="mb-1 block text-sm font-medium">Give to</label>
          <select id="uw-to" className="field" value={to} onChange={(e) => setTo(e.target.value)} disabled={!from}>
            <option value="">Choose…</option>
            <option value="unassign">Nobody (unassign)</option>
            {targets.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
      </div>

      {count === null ? (
        <button type="button" className="btn w-full sm:w-auto" disabled={!from || pending} onClick={check}>
          {pending ? "Checking…" : "Check how many"}
        </button>
      ) : count === 0 ? (
        <p role="status" className="rounded-lg bg-warn-bg px-3 py-2 text-sm">This caller has no unworked leads.</p>
      ) : (
        <div className="space-y-2">
          <p role="status" className="rounded-lg bg-warn-bg px-3 py-2 text-sm">
            <strong>{count.toLocaleString("en-IN")}</strong> never-called {count === 1 ? "lead" : "leads"} will move.
          </p>
          <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={!to || pending} onClick={move}>
            {pending ? "Moving…" : `Move ${count.toLocaleString("en-IN")} ${count === 1 ? "lead" : "leads"}`}
          </button>
        </div>
      )}
      <div aria-live="polite">
        {notice && (
          <p role={notice.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${notice.ok ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}>
            {notice.text}
          </p>
        )}
      </div>
    </div>
  );
}
