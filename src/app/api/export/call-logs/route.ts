import type { NextRequest } from "next/server";
import { z } from "zod";
import { friendlyError } from "@/lib/errors";
import { callLogColumns, type CallLogRow } from "@/lib/export";
import { callerNameMap, fileResponse, jsonError, MAX_LOG_ROWS, PAGE, staffOrError } from "@/lib/export-server";
import { resolveRange } from "@/lib/range";

const query = z.object({
  format: z.enum(["csv", "xlsx"]),
  range: z.string().max(10).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await staffOrError();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return jsonError(400, "That export request wasn't valid. Go back and try again.");
  const { format, range, from, to } = parsed.data;
  const r = resolveRange(range, from, to);

  const base = () => supabase.from("call_logs");
  const filtered = <T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(b: T) => {
    let x = b;
    if (r.from) x = x.gte("created_at", r.from);
    if (r.to) x = x.lt("created_at", r.to);
    return x;
  };

  const { count, error: countError } = await filtered(base().select("id", { count: "exact", head: true }));
  if (countError) return jsonError(500, friendlyError(countError));
  if ((count ?? 0) > MAX_LOG_ROWS) {
    return jsonError(413, `That period has ${(count ?? 0).toLocaleString("en-IN")} calls, more than the ${MAX_LOG_ROWS.toLocaleString("en-IN")} one export can hold. Choose a shorter period.`);
  }

  const rows: CallLogRow[] = [];
  for (let offset = 0; offset < (count ?? 0); offset += PAGE) {
    const { data, error } = await filtered(
      base().select("id, created_at, outcome, note, callback_at, caller_id, lead:leads(name, phone, reg_no)"),
    ).order("created_at", { ascending: true }).order("id", { ascending: true }).range(offset, offset + PAGE - 1);
    if (error) return jsonError(500, friendlyError(error));
    rows.push(...((data ?? []) as unknown as CallLogRow[]));
  }

  const names = await callerNameMap(supabase);
  const { error: auditError } = await supabase.rpc("log_export", {
    p_kind: "call_logs", p_format: format, p_rows: rows.length, p_filters: { range: r.preset, from: r.from, to: r.to },
  });
  if (auditError) return jsonError(500, friendlyError(auditError));

  return fileResponse("call-logs", format, callLogColumns(names), rows);
}
