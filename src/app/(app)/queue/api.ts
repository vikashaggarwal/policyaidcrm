// Browser-side calls. Every one runs as the signed-in caller, so Row Level Security decides what they can see.
import { friendlyError } from "@/lib/errors";
import type { Outcome } from "@/lib/outcomes";
import {
  PAGE_SIZE, toCounts, type HistoryItem, type LeadDetail, type OtherVehicle,
  type QueueCounts, type QueueFilter, type QueueRow,
} from "@/lib/queue-types";
import { createClient } from "@/lib/supabase/client";

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; message: string };
export type Result<T> = Ok<T> | Fail;

async function guard<T>(fn: () => Promise<{ data: T | null; error: { message?: string } | null }>): Promise<Result<T>> {
  try {
    const { data, error } = await fn();
    if (error || data === null) return { ok: false, message: friendlyError(error) };
    return { ok: true, data };
  } catch {
    return { ok: false, message: friendlyError({ message: "network" }) };
  }
}

export const fetchQueue = (filter: QueueFilter, search: string, limit = PAGE_SIZE, offset = 0) =>
  guard<QueueRow[]>(async () => {
    const r = await createClient().rpc("my_queue", { p_filter: filter, p_search: search || null, p_limit: limit, p_offset: offset });
    return { data: r.data as QueueRow[] | null, error: r.error };
  });

export const fetchCounts = (search: string) =>
  guard<QueueCounts>(async () => {
    const r = await createClient().rpc("my_queue_counts", { p_search: search || null });
    const row = (Array.isArray(r.data) ? r.data[0] : r.data) as Record<string, unknown> | null;
    return { data: r.error ? null : toCounts(row), error: r.error };
  });

export const fetchLead = (id: string) =>
  guard<LeadDetail>(async () => {
    const r = await createClient().from("leads").select("*").eq("id", id).maybeSingle();
    return { data: r.data as LeadDetail | null, error: r.error };
  });

export const fetchHistory = (id: string) =>
  guard<HistoryItem[]>(async () => {
    const r = await createClient().rpc("lead_history", { p_lead_id: id });
    return { data: r.data as HistoryItem[] | null, error: r.error };
  });

export const fetchOtherVehicles = (id: string) =>
  guard<OtherVehicle[]>(async () => {
    const r = await createClient().rpc("other_vehicles", { p_lead_id: id });
    return { data: r.data as OtherVehicle[] | null, error: r.error };
  });

/** One transaction in the database: writes the history row and updates the lead together. */
export const saveCall = (leadId: string, outcome: Outcome, note: string, callbackIso: string | null) =>
  guard<unknown>(async () => {
    const r = await createClient().rpc("log_call", {
      p_lead_id: leadId, p_outcome: outcome, p_note: note.trim() || null, p_callback_at: callbackIso,
    });
    return { data: r.error ? null : (r.data ?? true), error: r.error };
  });
