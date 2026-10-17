"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

type Fail = { ok: false; message: string };
const fail = (message: string): Fail => ({ ok: false, message });
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

const STATUSES = ["any", "new", "no_answer", "message_sent", "callback", "interested", "sold", "not_interested", "wrong_number", "do_not_call"] as const;
const filtersSchema = z.object({
  assigned: z.string().max(40),
  status: z.enum(STATUSES),
  q: z.string().max(60),
  batch: z.uuid().nullable(),
});
const idsSchema = z.array(z.uuid()).min(1, "Select at least one lead first.").max(5000, "Select up to 5,000 leads at a time.");
const targetSchema = z.uuid().nullable();

const STAFF = ["admin", "manager"] as const;

/** "Select all N that match the current filters", up to the 5,000 a bulk action can take. */
export async function selectAllMatching(filters: unknown): Promise<{ ok: true; ids: string[] } | Fail> {
  await requireProfile([...STAFF]);
  const f = filtersSchema.safeParse(filters);
  if (!f.success) return fail("Those filters weren't valid. Refresh the page and try again.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("staff_lead_ids", {
    p_assigned: f.data.assigned, p_status: f.data.status, p_search: f.data.q || null, p_batch: f.data.batch,
  });
  if (error) return fail(friendlyError(error));
  return { ok: true, ids: (data ?? []) as string[] };
}

export async function reassignLeads(ids: unknown, to: unknown): Promise<{ ok: true; message: string } | Fail> {
  await requireProfile([...STAFF]);
  const i = idsSchema.safeParse(ids);
  const t = targetSchema.safeParse(to);
  if (!i.success) return fail(i.error.issues[0]?.message ?? "Select at least one lead first.");
  if (!t.success) return fail("Choose who should get these leads.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reassign_leads", { p_lead_ids: i.data, p_to: t.data });
  if (error) return fail(friendlyError(error));
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  return { ok: true, message: `Reassigned ${plural(Number(data ?? 0), "lead", "leads")}.` };
}

/** Puts wrong-number leads back to "new" (a caller's mis-tap, or the number was corrected). Other leads are untouched. */
export async function reopenLeads(ids: unknown): Promise<{ ok: true; message: string } | Fail> {
  await requireProfile([...STAFF]);
  const i = idsSchema.safeParse(ids);
  if (!i.success) return fail(i.error.issues[0]?.message ?? "Select at least one lead first.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reopen_leads", { p_lead_ids: i.data });
  if (error) return fail(friendlyError(error));
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  const n = Number(data ?? 0);
  return {
    ok: true,
    message: n === 0
      ? "None of the selected leads were marked wrong number, so nothing changed."
      : `Reopened ${plural(n, "lead", "leads")}. ${n === 1 ? "It is" : "They are"} back in the caller's queue as new.`,
  };
}

export async function countUnworked(from: unknown): Promise<{ ok: true; count: number } | Fail> {
  await requireProfile([...STAFF]);
  const f = z.uuid().safeParse(from);
  if (!f.success) return fail("Choose a caller first.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unworked_count", { p_caller: f.data });
  if (error) return fail(friendlyError(error));
  return { ok: true, count: Number(data ?? 0) };
}

export async function reassignUnworked(from: unknown, to: unknown): Promise<{ ok: true; message: string } | Fail> {
  await requireProfile([...STAFF]);
  const f = z.uuid().safeParse(from);
  const t = targetSchema.safeParse(to);
  if (!f.success || !t.success) return fail("Choose the caller to take leads from and who should get them.");
  if (f.data === t.data) return fail("Pick two different callers.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reassign_unworked", { p_from: f.data, p_to: t.data });
  if (error) return fail(friendlyError(error));
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  const n = Number(data ?? 0);
  return { ok: true, message: n === 0 ? "No unworked leads to move." : `Moved ${plural(n, "unworked lead", "unworked leads")}.` };
}

/** Admin only. Each deletion is written to the audit log by the database. */
export async function deleteLeads(ids: unknown): Promise<{ ok: true; message: string } | Fail> {
  await requireProfile(["admin"]);
  const i = idsSchema.safeParse(ids);
  if (!i.success) return fail(i.error.issues[0]?.message ?? "Select at least one lead first.");

  const supabase = await createClient();
  let deleted = 0;
  for (let k = 0; k < i.data.length; k += 100) {
    const { data, error } = await supabase.from("leads").delete().in("id", i.data.slice(k, k + 100)).select("id");
    if (error) {
      return fail(`${friendlyError(error)}${deleted > 0 ? ` ${plural(deleted, "lead was", "leads were")} already deleted.` : ""}`);
    }
    deleted += data?.length ?? 0;
  }
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  return { ok: true, message: `Deleted ${plural(deleted, "lead", "leads")}. This is recorded in the audit log.` };
}
