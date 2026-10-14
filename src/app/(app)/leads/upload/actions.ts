"use server";

import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { CHUNK_SIZE } from "@/lib/upload/parse";
import { resolveAssignee, type CallerRef } from "@/lib/upload/assignee";
import { validateRow, type RawRecord } from "@/lib/upload/validate";

const STAFF = ["admin", "manager"] as const;

type Fail = { ok: false; message: string };
const fail = (message: string): Fail => ({ ok: false, message });

export async function beginUpload(filename: string, totalRows: number): Promise<{ ok: true; batchId: string } | Fail> {
  await requireProfile([...STAFF]);
  const parsed = z.object({ filename: z.string().min(1).max(255), totalRows: z.number().int().min(0).max(100000) })
    .safeParse({ filename, totalRows });
  if (!parsed.success) return fail("That upload isn't valid. Check the file and try again.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("begin_upload", {
    p_filename: parsed.data.filename, p_total_rows: parsed.data.totalRows,
  });
  if (error || !data) return fail(friendlyError(error));
  return { ok: true, batchId: data as string };
}

/** Which of these registration numbers are already in the system? */
export async function findExisting(regNos: string[]): Promise<{ ok: true; existing: string[] } | Fail> {
  await requireProfile([...STAFF]);
  const parsed = z.array(z.string().max(20)).max(5000).safeParse(regNos);
  if (!parsed.success) return fail("That request was too large. Please try again.");
  if (parsed.data.length === 0) return { ok: true, existing: [] };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("existing_reg_nos", { p_reg_nos: parsed.data });
  if (error) return fail(friendlyError(error));
  return { ok: true, existing: (data ?? []) as string[] };
}

const rawValue = z.union([z.string().max(1000), z.number(), z.null()]);
const chunkSchema = z.object({
  batchId: z.uuid(),
  rows: z.array(z.object({ rowNumber: z.number().int().positive(), raw: z.record(z.string(), rawValue) })).max(CHUNK_SIZE),
});

export type ChunkResult =
  | { ok: true; added: number; duplicates: number; invalid: number; unassigned: number }
  | Fail;

/**
 * Re-validates every row on the server (the browser's preview is a convenience, not trusted),
 * then inserts. Registration numbers that already exist are skipped, never overwritten.
 */
export async function importChunk(input: unknown): Promise<ChunkResult> {
  const me = await requireProfile([...STAFF]);
  const parsed = chunkSchema.safeParse(input);
  if (!parsed.success) return fail("That batch of rows wasn't in the expected format. Re-select the file and try again.");
  const { batchId, rows } = parsed.data;

  const supabase = await createClient();
  const { data: batch } = await supabase
    .from("upload_batches").select("id").eq("id", batchId).eq("uploaded_by", me.id).is("finished_at", null).maybeSingle();
  if (!batch) return fail("This upload is already closed. Start a new upload.");

  const { data: callerRows, error: callerErr } = await supabase
    .from("profiles").select("id, full_name, login_id").eq("role", "caller").eq("active", true);
  if (callerErr) return fail(friendlyError(callerErr));
  const callers = (callerRows ?? []) as CallerRef[];

  let invalid = 0;
  let duplicates = 0;
  let unassigned = 0;
  const seen = new Set<string>();
  const toInsert: Record<string, unknown>[] = [];

  for (const { raw } of rows) {
    const result = validateRow(raw as RawRecord);
    if (!result.ok) { invalid += 1; continue; }
    const { assignee_text, ...lead } = result.lead;
    if (seen.has(lead.reg_no)) { duplicates += 1; continue; }
    seen.add(lead.reg_no);
    const assignedTo = resolveAssignee(assignee_text, callers);
    if (assignee_text && !assignedTo) unassigned += 1;
    toInsert.push({ ...lead, assigned_to: assignedTo, batch_id: batchId });
  }

  let added = 0;
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .upsert(toInsert, { onConflict: "reg_no", ignoreDuplicates: true })
      .select("reg_no");
    if (error) return fail(friendlyError(error));
    added = data?.length ?? 0;
    duplicates += toInsert.length - added;
  }
  return { ok: true, added, duplicates, invalid, unassigned };
}

export async function finishUpload(
  batchId: string, duplicates: number, invalid: number,
): Promise<{ ok: true; added: number } | Fail> {
  await requireProfile([...STAFF]);
  const parsed = z.object({ batchId: z.uuid(), duplicates: z.number().int().min(0), invalid: z.number().int().min(0) })
    .safeParse({ batchId, duplicates, invalid });
  if (!parsed.success) return fail("That upload isn't valid. Check the file and try again.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finish_upload", {
    p_batch: parsed.data.batchId, p_duplicates: parsed.data.duplicates, p_invalid: parsed.data.invalid,
  });
  if (error) return fail(friendlyError(error));
  const row = (Array.isArray(data) ? data[0] : data) as { added: number } | null;
  return { ok: true, added: row?.added ?? 0 };
}
