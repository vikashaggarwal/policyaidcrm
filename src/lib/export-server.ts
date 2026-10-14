import "server-only";
import { toCsv, type Column } from "@/lib/csv";
import { istDay } from "@/lib/export";
import { toXlsx } from "@/lib/export-xlsx";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isStaff } from "@/lib/types";

export const PAGE = 1000; // PostgREST returns at most 1,000 rows per request
export const MAX_LEAD_ROWS = 60_000;
export const MAX_LOG_ROWS = 100_000;

export const jsonError = (status: number, message: string) =>
  new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export async function staffOrError() {
  const profile = await getProfile();
  if (!profile) return { error: jsonError(401, "Your session ended. Sign in again.") };
  if (!isStaff(profile.role)) return { error: jsonError(403, "Only managers and admins can export data.") };
  return { profile, supabase: await createClient() };
}

export async function callerNameMap(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("profiles").select("id, full_name");
  return new Map((data ?? []).map((p) => [p.id as string, p.full_name as string]));
}

export function fileResponse<T>(
  kind: "leads" | "call-logs", format: "csv" | "xlsx", columns: Column<T>[], rows: T[],
) {
  const stamp = istDay(new Date());
  const name = `dialdesk-${kind}-${stamp}.${format}`;
  const body = format === "csv" ? toCsv(columns, rows) : toXlsx(kind === "leads" ? "Leads" : "Call logs", columns, rows);
  return new Response(body as BodyInit, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
