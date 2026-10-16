"use client";

import { useRef, useState } from "react";
import type { FieldErrors, NewLeadField, NewLeadForm } from "@/lib/new-lead";
import type { LeadDetail } from "@/lib/queue-types";
import { updateLead } from "./actions";
import { DETAIL_FIELDS, type FieldDef } from "./lead-fields";

const toForm = (l: LeadDetail): NewLeadForm => {
  const s = (v: string | number | null) => (v === null || v === undefined ? "" : String(v));
  return {
    name: s(l.name), phone: s(l.phone), guardian_name: s(l.guardian_name), reg_no: s(l.reg_no), reg_date: s(l.reg_date),
    renewal_date: s(l.renewal_date), vehicle_make: s(l.vehicle_make), vehicle_model: s(l.vehicle_model),
    vehicle_class: s(l.vehicle_class), fuel: s(l.fuel), seat_capacity: s(l.seat_capacity), sale_amount: s(l.sale_amount),
    city: s(l.city), state: s(l.state), rto_code: s(l.rto_code), engine_no: s(l.engine_no), chassis_no: s(l.chassis_no),
    address: s(l.address),
  };
};

/** Every detail on the lead, editable. Saving re-validates on the server and the database records what changed. */
export function EditDetails({ lead, onSaved, onCancel }: { lead: LeadDetail; onSaved: (lead: LeadDetail) => void; onCancel: () => void }) {
  const [form, setForm] = useState<NewLeadForm>(() => toForm(lead));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);

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
      const res = await updateLead(lead.id, form);
      if (!res.ok) {
        setErrors(res.errors ?? {});
        setMessage(res.errors && Object.keys(res.errors).length > 0 ? null : res.message);
        locked.current = false;
        return;
      }
      onSaved(res.lead);
    } catch {
      setMessage("We couldn't reach the server. Check your internet and try again.");
      locked.current = false;
    } finally {
      setSaving(false);
    }
  }

  const field = (f: FieldDef & { required?: boolean }) => (
    <div key={f.name} className={f.wide ? "sm:col-span-2" : ""}>
      <label htmlFor={`ed-${f.name}`} className="mb-1 block text-sm font-medium">
        {f.label}{f.required && <span className="text-danger"> (required)</span>}
      </label>
      <input
        id={`ed-${f.name}`} className="field" type={f.type ?? "text"} inputMode={f.inputMode} placeholder={f.placeholder}
        value={form[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} autoComplete="off"
        aria-invalid={errors[f.name] ? true : undefined} aria-describedby={errors[f.name] ? `ed-${f.name}-err` : undefined}
      />
      {errors[f.name] && <p id={`ed-${f.name}-err`} role="alert" className="mt-1 text-sm text-danger">{errors[f.name]}</p>}
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)} noValidate aria-label="Edit lead details">
      <div className="grid gap-4 sm:grid-cols-2">
        {field({ name: "name", label: "Name", required: true })}
        {field({ name: "phone", label: "Mobile number", type: "tel", inputMode: "numeric", required: true })}
        {DETAIL_FIELDS.map(field)}
      </div>
      {message && <p role="alert" className="mt-4 rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{message}</p>}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" className="btn !min-h-14" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary !min-h-14" disabled={saving}>{saving ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}
