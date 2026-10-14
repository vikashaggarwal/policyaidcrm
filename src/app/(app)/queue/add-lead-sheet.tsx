"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldErrors, NewLeadField, NewLeadForm } from "@/lib/new-lead";
import type { QueueRow } from "@/lib/queue-types";
import { addLead } from "./actions";

type FieldDef = { name: NewLeadField; label: string; type?: string; inputMode?: "numeric" | "decimal" | "text" | "tel"; placeholder?: string; wide?: boolean };

const MORE_FIELDS: FieldDef[] = [
  { name: "guardian_name", label: "Owner (S/W/D)" },
  { name: "reg_no", label: "Registration no.", placeholder: "MH12AB1234" },
  { name: "reg_date", label: "Registration date", type: "date" },
  { name: "vehicle_make", label: "Vehicle make", placeholder: "e.g. Honda" },
  { name: "vehicle_model", label: "Model / variant", placeholder: "e.g. Activa 6G" },
  { name: "vehicle_class", label: "Vehicle class" },
  { name: "fuel", label: "Fuel" },
  { name: "seat_capacity", label: "Seat capacity", inputMode: "numeric" },
  { name: "sale_amount", label: "Sale amount (₹)", inputMode: "decimal" },
  { name: "city", label: "City" },
  { name: "state", label: "State" },
  { name: "rto_code", label: "RTO code", placeholder: "MH12" },
  { name: "engine_no", label: "Engine no." },
  { name: "chassis_no", label: "Chassis no." },
  { name: "address", label: "Address", wide: true },
];

export function AddLeadSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (lead: QueueRow) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<NewLeadForm>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const set = (k: NewLeadField, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const res = await addLead(form);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.errors && Object.keys(res.errors).length > 0 ? null : res.message);
        locked.current = false;
        return;
      }
      onAdded(res.lead);
    } catch {
      setMessage("We couldn't reach the server. Check your internet and try again.");
      locked.current = false;
    } finally {
      setSaving(false);
    }
  }

  const input = (f: FieldDef) => (
    <div key={f.name} className={f.wide ? "sm:col-span-2" : ""}>
      <label htmlFor={`nl-${f.name}`} className="mb-1 block text-sm font-medium">{f.label}</label>
      <input
        id={`nl-${f.name}`} className="field" type={f.type ?? "text"} inputMode={f.inputMode} placeholder={f.placeholder}
        value={form[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} autoComplete="off"
        aria-invalid={errors[f.name] ? true : undefined} aria-describedby={errors[f.name] ? `nl-${f.name}-err` : undefined}
      />
      {errors[f.name] && <p id={`nl-${f.name}-err`} className="mt-1 text-sm text-danger">{errors[f.name]}</p>}
    </div>
  );

  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="add-title" onClose={onClose}
      onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 id="add-title" className="text-lg font-bold">Add a lead</h2>
            <p className="text-sm text-muted">Only name and mobile number are needed. It&apos;s added to your queue.</p>
          </div>
          <button type="button" className="btn !min-h-11 shrink-0 !px-4" onClick={() => dialog.current?.close()}>Close</button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <label htmlFor="nl-name" className="mb-1 block text-sm font-medium">Name <span className="text-danger">(required)</span></label>
            <input
              id="nl-name" className="field" autoComplete="off" required value={form.name ?? ""} onChange={(e) => set("name", e.target.value)}
              aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? "nl-name-err" : undefined}
            />
            {errors.name && <p id="nl-name-err" className="mt-1 text-sm text-danger">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="nl-phone" className="mb-1 block text-sm font-medium">Mobile number <span className="text-danger">(required)</span></label>
            <input
              id="nl-phone" className="field" type="tel" inputMode="numeric" autoComplete="off" required placeholder="10 digits"
              value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)}
              aria-invalid={errors.phone ? true : undefined} aria-describedby={errors.phone ? "nl-phone-err" : undefined}
            />
            {errors.phone && <p id="nl-phone-err" role="alert" className="mt-1 text-sm text-danger">{errors.phone}</p>}
          </div>

          <details className="rounded-lg border border-line px-3" open={MORE_FIELDS.some((f) => errors[f.name])}>
            <summary className="flex min-h-12 cursor-pointer items-center font-medium">More details (optional)</summary>
            <div className="grid gap-4 pb-4 sm:grid-cols-2">{MORE_FIELDS.map(input)}</div>
          </details>
        </div>

        <div className="sticky bottom-0 space-y-2 border-t border-line bg-surface p-4">
          {message && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{message}</p>}
          <button type="submit" disabled={saving} className="btn btn-primary !min-h-14 w-full text-base">
            {saving ? "Adding…" : "Add lead"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
