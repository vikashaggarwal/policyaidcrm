"use client";

import { useEffect, useRef, useState } from "react";
import { OUTCOMES, STATUS_LABEL, STATUS_STYLE, type Outcome } from "@/lib/outcomes";
import type { HistoryItem, LeadDetail, OtherVehicle, QueueRow } from "@/lib/queue-types";
import { callbackPresets, formatDate, formatIst, isoToIstLocal, istLocalToIso } from "@/lib/time";
import { EditDetails } from "./edit-details";
import { fetchHistory, fetchLead, fetchOtherVehicles, saveCall } from "./api";

const NOTE_MAX = 1000;

type Loaded = { lead: LeadDetail; history: HistoryItem[]; others: OtherVehicle[] };

export function LeadSheet({
  row, onClose, onSaved, onEdited,
}: { row: QueueRow; onClose: () => void; onSaved: (message: string) => void; onEdited: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [callbackLocal, setCallbackLocal] = useState("");
  const [note, setNote] = useState("");
  const [confirmDnd, setConfirmDnd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [lead, history, others] = await Promise.all([fetchLead(row.id), fetchHistory(row.id), fetchOtherVehicles(row.id)]);
      if (cancelled) return;
      if (!lead.ok) { setLoadError(lead.message); return; }
      setData({ lead: lead.data, history: history.ok ? history.data : [], others: others.ok ? others.data : [] });
    })();
    return () => { cancelled = true; };
  }, [row.id]);

  const needsCallback = outcome === "callback";
  const canHaveCallback = outcome === "callback" || outcome === "interested" || outcome === "no_answer";
  const phone = data?.lead.phone ?? row.phone; // follows a corrected number
  const ownerName = data?.lead.name ?? row.name;
  const phoneOk = /^\d{10}$/.test(phone);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(phone);
    } catch {
      const t = document.createElement("textarea");
      t.value = phone; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch { /* nothing more we can do */ }
      t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function pickOutcome(o: Outcome) {
    setOutcome(o); setConfirmDnd(false); setSaveError(null);
    if (o === "sold" || o === "not_interested" || o === "do_not_call" || o === "wrong_number") setCallbackLocal("");
  }

  async function save() {
    if (!outcome || locked.current) return;
    setSaveError(null);

    if ((outcome === "do_not_call" || outcome === "wrong_number") && !confirmDnd) { setConfirmDnd(true); return; }

    let callbackIso: string | null = null;
    if (canHaveCallback && callbackLocal) {
      callbackIso = istLocalToIso(callbackLocal);
      if (!callbackIso) { setSaveError("That callback date and time isn't valid. Pick it again."); return; }
      if (new Date(callbackIso).getTime() < Date.now() - 5 * 60_000) {
        setSaveError("The callback time has already passed. Pick a time in the future.");
        return;
      }
    }
    if (needsCallback && !callbackIso) { setSaveError("Pick a date and time for the callback."); return; }

    locked.current = true; // a double-tap must never write two history rows
    setSaving(true);
    const res = await saveCall(row.id, outcome, note, callbackIso);
    setSaving(false);
    if (!res.ok) { locked.current = false; setSaveError(res.message); return; }
    onSaved(`Saved: ${STATUS_LABEL[outcome]} · ${row.name}`);
  }

  const lead = data?.lead;
  const presets = callbackPresets();
  const minLocal = isoToIstLocal(new Date());

  return (
    <dialog
      ref={dialog} className="sheet" aria-labelledby="sheet-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="min-w-0">
          <h2 id="sheet-title" className="truncate text-lg font-bold">{ownerName}</h2>
          <p className="break-words text-sm text-muted">
            {[row.vehicle_make, row.vehicle_model, row.reg_no].filter(Boolean).join(" · ") || "No vehicle details yet"}
          </p>
        </div>
        <button type="button" className="btn !min-h-11 shrink-0 !px-4" onClick={() => dialog.current?.close()}>Close</button>
      </div>

      <div className="space-y-5 p-4">
        {/* Call */}
        <section aria-label="Call" className="space-y-3">
          <p className="text-2xl font-bold tracking-wide" aria-label={`Mobile number ${phone.split("").join(" ")}`}>{phone}</p>
          <div className="grid grid-cols-2 gap-3">
            {phoneOk ? (
              <a href={`tel:+91${phone}`} className="btn btn-primary flex items-center justify-center !min-h-14 text-lg">Call</a>
            ) : (
              <span className="btn flex items-center justify-center !min-h-14 opacity-60">No valid number</span>
            )}
            <button type="button" className="btn !min-h-14" onClick={() => void copyNumber()}>
              {copied ? "Copied ✓" : "Copy number"}
            </button>
          </div>
          <p className="sr-only" role="status">{copied ? "Number copied" : ""}</p>
          {data && data.others.length > 0 && (
            <details className="rounded-lg bg-warn-bg px-3 py-2 text-sm">
              <summary className="min-h-10 cursor-pointer py-2 font-medium">
                This owner has {data.others.length} other {data.others.length === 1 ? "vehicle" : "vehicles"} on this number
              </summary>
              <ul className="mb-1 space-y-1">
                {data.others.map((o) => (
                  <li key={`${o.reg_no}-${o.vehicle_model}`}>{[o.vehicle_make, o.vehicle_model].filter(Boolean).join(" ") || "Vehicle"}{o.reg_no ? ` · ${o.reg_no}` : ""} · {STATUS_LABEL[o.status]}</li>
                ))}
              </ul>
              <p className="text-muted">Mention them on this call rather than ringing again.</p>
            </details>
          )}
        </section>

        {/* Details */}
        <section aria-labelledby="details-h">
          <h3 id="details-h" className="mb-2 font-semibold">Lead details</h3>
          {loadError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{loadError}</p>}
          {!data && !loadError && <div className="h-40 animate-pulse rounded-lg bg-line" aria-label="Loading details" />}
          {lead && !editing && (
            <>
              <Details lead={lead} />
              <button type="button" className="btn mt-3 !min-h-12 w-full" onClick={() => setEditing(true)}>Edit details</button>
            </>
          )}
          {lead && editing && (
            <EditDetails
              lead={lead}
              onCancel={() => setEditing(false)}
              onSaved={(updated) => { setData((d) => (d ? { ...d, lead: updated } : d)); setEditing(false); onEdited(); }}
            />
          )}
        </section>

        {!editing && <>
        {/* Outcome */}
        <section aria-labelledby="outcome-h">
          <h3 id="outcome-h" className="mb-2 font-semibold">How did the call go?</h3>
          <div className="grid grid-cols-2 gap-3">
            {OUTCOMES.map((o) => (
              <button
                key={o.value} type="button" aria-pressed={outcome === o.value} onClick={() => pickOutcome(o.value)}
                className={`btn !min-h-14 text-base ${
                  outcome === o.value
                    ? o.value === "do_not_call" ? "!border-transparent !bg-danger !text-bg" : "!border-transparent !bg-primary !text-primary-ink"
                    : o.value === "do_not_call" ? "btn-danger" : ""
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {outcome && <p className="mt-2 text-sm text-muted">{OUTCOMES.find((o) => o.value === outcome)?.hint}</p>}
        </section>

        {canHaveCallback && (
          <section aria-labelledby="cb-h">
            <h3 id="cb-h" className="mb-2 font-semibold">
              Call back {needsCallback ? <span className="text-danger">(required)</span> : <span className="font-normal text-muted">(optional)</span>}
            </h3>
            <div className="mb-3 flex flex-wrap gap-2">
              {presets.map((p) => (
                <button key={p.label} type="button" className="btn !min-h-11 text-sm" onClick={() => setCallbackLocal(isoToIstLocal(p.iso))}>
                  {p.label}
                </button>
              ))}
            </div>
            <label htmlFor="cb" className="sr-only">Callback date and time (India time)</label>
            <input
              id="cb" type="datetime-local" className="field" value={callbackLocal} min={minLocal}
              onChange={(e) => setCallbackLocal(e.target.value)}
            />
            <p className="mt-1 text-sm text-muted">
              India time{callbackLocal && istLocalToIso(callbackLocal) ? ` · ${formatIst(istLocalToIso(callbackLocal)!)}` : ""}
            </p>
          </section>
        )}

        <section aria-labelledby="note-h">
          <label id="note-h" htmlFor="note" className="mb-2 block font-semibold">Note <span className="font-normal text-muted">(optional)</span></label>
          <textarea
            id="note" className="field !min-h-24 py-3" rows={3} maxLength={NOTE_MAX} value={note}
            onChange={(e) => setNote(e.target.value)} placeholder="What was said? Policy due date, quote asked, best time…"
          />
          <p className="mt-1 text-right text-xs text-muted">{note.length}/{NOTE_MAX}</p>
        </section>

        {/* History */}
        <section aria-labelledby="hist-h">
          <h3 id="hist-h" className="mb-2 font-semibold">Call history</h3>
          {!data ? null : data.history.length === 0 ? (
            <p className="text-sm text-muted">No calls yet. This will be the first.</p>
          ) : (
            <ol className="space-y-3">
              {data.history.map((h) => (
                <li key={h.id} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[h.outcome]}`}>{STATUS_LABEL[h.outcome]}</span>
                    <span className="text-muted">{formatIst(h.created_at)}</span>
                  </div>
                  <p className="mt-1 text-muted">{h.caller_name}{h.callback_at ? ` · call back ${formatIst(h.callback_at)}` : ""}</p>
                  {h.note && <p className="mt-1 whitespace-pre-wrap break-words">{h.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
        </>}
      </div>

      {/* Save stays in reach while the sheet scrolls */}
      {!editing && <div className="sticky bottom-0 space-y-2 border-t border-line bg-surface p-4">
        {outcome === "do_not_call" && confirmDnd && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            This permanently removes this number from every queue, including any other vehicles on it. Only an admin can undo it.
          </p>
        )}
        {outcome === "wrong_number" && confirmDnd && (
          <p role="alert" className="rounded-lg bg-warn-bg px-3 py-2 text-sm">
            This removes the lead from your queue, along with any other vehicles on the same number that haven&apos;t been worked.
            You can&apos;t undo it yourself; a manager can reopen it if the number is corrected.
          </p>
        )}
        {saveError && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{saveError}</p>}
        <button
          type="button" disabled={!outcome || saving} onClick={() => void save()}
          className={`btn !min-h-14 w-full text-base ${outcome === "do_not_call" && confirmDnd ? "!bg-danger !text-bg" : "btn-primary"}`}
        >
          {saving ? "Saving…"
            : !outcome ? "Choose an outcome to save"
            : outcome === "do_not_call" && confirmDnd ? "Yes, never call this number again"
            : outcome === "wrong_number" && confirmDnd ? "Yes, this is a wrong number"
            : `Save: ${STATUS_LABEL[outcome]}`}
        </button>
      </div>}
    </dialog>
  );
}

function Details({ lead }: { lead: LeadDetail }) {
  const money = (n: number | null) => (n === null ? null : `₹${n.toLocaleString("en-IN")}`);
  const items: [string, string | number | null][] = [
    ["Owner", lead.name],
    ["Owner (S/W/D)", lead.guardian_name],
    ["Mobile", lead.phone],
    ["Reg. no", lead.reg_no],
    ["Reg. date", lead.reg_date ? formatDate(lead.reg_date) : null],
    ["Renewal date", lead.renewal_date ? formatDate(lead.renewal_date) : null],
    ["Make", lead.vehicle_make],
    ["Model / variant", lead.vehicle_model],
    ["Class", lead.vehicle_class],
    ["Fuel", lead.fuel],
    ["Seats", lead.seat_capacity],
    ["Sale amount", money(lead.sale_amount)],
    ["Engine no", lead.engine_no],
    ["Chassis no", lead.chassis_no],
    ["State", lead.state],
    ["RTO", lead.rto_code],
    ["Address", lead.address],
    ["City", lead.city],
  ];
  return (
    <>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {items.map(([k, v]) => (
        <div key={k} className={k === "Address" ? "col-span-2" : ""}>
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="break-words font-medium">{v === null || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[lead.status]}`}>{STATUS_LABEL[lead.status]}</span>
        <span className="text-muted">
          {lead.attempts} {lead.attempts === 1 ? "call" : "calls"}
          {lead.last_called_at ? ` · last ${formatIst(lead.last_called_at)}` : ""}
          {lead.callback_at ? ` · call back ${formatIst(lead.callback_at)}` : ""}
        </span>
      </div>
    </>
  );
}
