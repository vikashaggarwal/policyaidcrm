"use server";

import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { validateNewLead, type FieldErrors, type NewLeadForm } from "@/lib/new-lead";
import type { QueueRow } from "@/lib/queue-types";
import { createClient } from "@/lib/supabase/server";

export type AddLeadResult =
  | { ok: true; lead: QueueRow }
  | { ok: false; message: string; errors?: FieldErrors };

const formSchema = z.record(z.string(), z.string().max(600));

// Which field a database refusal belongs to, so the message appears next to it.
const FIELD_FOR_CODE: [RegExp, keyof FieldErrors][] = [
  [/name_required/, "name"],
  [/invalid_phone|duplicate_phone|lead_blocked/, "phone"],
  [/invalid_reg_no|duplicate_vehicle/, "reg_no"],
  [/invalid_date/, "reg_date"],
];

/** A caller adds a lead they found themselves. It is assigned to them and the database re-checks everything. */
export async function addLead(input: unknown): Promise<AddLeadResult> {
  await requireProfile(["caller"]);
  const parsed = formSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That form wasn't in the expected format. Refresh the page and try again." };

  const checked = validateNewLead(parsed.data as NewLeadForm);
  if (!checked.ok) return { ok: false, message: "Please fix the highlighted fields.", errors: checked.errors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_lead", { p_lead: checked.payload });
  if (error || !data) {
    const message = friendlyError(error);
    const field = FIELD_FOR_CODE.find(([re]) => re.test(error?.message ?? ""))?.[1];
    return { ok: false, message, errors: field ? { [field]: message } : undefined };
  }

  const l = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  return {
    ok: true,
    lead: {
      id: l.id as string, name: l.name as string, phone: l.phone as string, city: (l.city as string) ?? null,
      reg_no: (l.reg_no as string) ?? null, vehicle_make: (l.vehicle_make as string) ?? null,
      vehicle_model: (l.vehicle_model as string) ?? null, status: "new", callback_at: null, attempts: 0,
      last_called_at: null, bucket: 2, total_count: 0,
    },
  };
}
