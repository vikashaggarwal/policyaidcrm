import type { LeadStatus } from "@/lib/types";

export type CallerStats = {
  id: string; name: string; login_id: string; active: boolean;
  assigned: number; unworked: number; overdue: number;
  calls: number; called: number; connected: number; interested: number; sold: number;
};

export type DashboardSummary = {
  loaded: number; called_once: number; sold: number;
  by_status: Partial<Record<LeadStatus, number>>;
  callbacks_due: number; unassigned_new: number; calls: number;
  callers: CallerStats[];
};

/** "12.5%" with one decimal, "—" when there is nothing to divide by. */
export function pct(part: number, whole: number): string {
  if (!whole) return "—";
  const v = (part / whole) * 100;
  return `${(Math.round(v * 10) / 10).toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
}

export const STATUS_ORDER: LeadStatus[] = ["new", "no_answer", "message_sent", "callback", "interested", "sold", "not_interested", "wrong_number", "do_not_call"];
