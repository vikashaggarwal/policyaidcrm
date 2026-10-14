import type { NextRequest } from "next/server";
import { z } from "zod";
import { friendlyError } from "@/lib/errors";
import { leadColumns, type LeadRow } from "@/lib/export";
import { callerNameMap, fileResponse, jsonError, MAX_LEAD_ROWS, PAGE, staffOrError } from "@/lib/export-server";

const STATUSES = ["any", "new", "no_answer", "callback", "interested", "sold", "not_interested", "do_not_call"] as const;
const query = z.object({
  format: z.enum(["csv", "xlsx"]),
  assigned: z.string().max(40).default("any"),
  status: z.enum(STATUSES).default("any"),
  q: z.string().max(60).default(""),
  batch: z.uuid().optional(),
});

export async function GET(request: NextRequest) {
  const auth = await staffOrError();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const raw = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = query.safeParse({ ...raw, batch: raw.batch || undefined });
  if (!parsed.success) return jsonError(400, "That export request wasn't valid. Go back and try again.");
  const { format, assigned, status, q, batch } = parsed.data;

  const rows: LeadRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.rpc("export_leads", {
      p_assigned: assigned, p_status: status, p_search: q || null, p_batch: batch ?? null, p_limit: PAGE, p_offset: offset,
    });
    if (error) return jsonError(500, friendlyError(error));
    const page = (data ?? []) as LeadRow[];
    rows.push(...page);
    if (rows.length > MAX_LEAD_ROWS) {
      return jsonError(413, `That is more than ${MAX_LEAD_ROWS.toLocaleString("en-IN")} leads. Narrow the filters (for example one caller at a time) and export again.`);
    }
    if (page.length < PAGE) break;
  }

  const names = await callerNameMap(supabase);
  const { error: auditError } = await supabase.rpc("log_export", {
    p_kind: "leads", p_format: format, p_rows: rows.length, p_filters: { assigned, status, q, batch: batch ?? null },
  });
  // An export we can't record doesn't leave the building.
  if (auditError) return jsonError(500, friendlyError(auditError));

  return fileResponse("leads", format, leadColumns(names), rows);
}
