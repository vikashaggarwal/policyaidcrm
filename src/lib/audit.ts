export type AuditEntry = {
  id: number; actor_id: string | null; action: string; entity: string; entity_id: string | null;
  details: Record<string, unknown>; created_at: string;
};

export const AUDIT_GROUPS: { value: string; label: string; actions: string[] }[] = [
  { value: "upload", label: "Uploads and new leads", actions: ["upload", "add_lead"] },
  { value: "reassign", label: "Reassignments", actions: ["reassign", "reassign_unworked"] },
  { value: "delete", label: "Deletions", actions: ["delete_lead"] },
  { value: "export", label: "Exports", actions: ["export"] },
  { value: "dnd", label: "Do not call", actions: ["do_not_call", "unblock_dnd"] },
  { value: "user", label: "User changes", actions: ["user_create", "user_reset_password", "user_activate", "user_deactivate", "user_role_change"] },
];

const n = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0)).toLocaleString("en-IN");
const s = (v: unknown) => (typeof v === "string" ? v : "");

/** One plain sentence per audit record. `names` maps profile ids to people. */
export function describeAudit(e: AuditEntry, names: Map<string, string>): string {
  const d = e.details ?? {};
  const who = (id: unknown) => (typeof id === "string" ? names.get(id) ?? "a removed user" : "nobody (unassigned)");
  switch (e.action) {
    case "upload":
      return `Uploaded “${s(d.filename)}”: ${n(d.added)} added, ${n(d.duplicates)} duplicates, ${n(d.invalid)} invalid (${n(d.total_rows)} rows)`;
    case "reassign":
      return `Reassigned ${n(d.count)} ${Number(d.count) === 1 ? "lead" : "leads"} to ${who(d.to)}`;
    case "reassign_unworked":
      return `Moved ${n(d.count)} unworked ${Number(d.count) === 1 ? "lead" : "leads"} from ${who(d.from)} to ${who(d.to)}`;
    case "add_lead":
      return `Added a lead${s(d.reg_no) ? ` (${s(d.reg_no)})` : ""}`;
    case "delete_lead":
      return `Deleted lead ${s(d.reg_no) || e.entity_id}`;
    case "export":
      return `Exported ${n(d.rows)} ${e.entity_id === "call_logs" ? "call log rows" : "leads"} as ${s(d.format).toUpperCase()}`;
    case "do_not_call":
      return `Marked ${s(d.reg_no) || "a lead"} do-not-call`;
    case "unblock_dnd":
      return `Lifted do-not-call on ${s(d.reg_no) || "a lead"}`;
    case "user_create":
      return `Created user ${s(d.login_id)} (${s(d.role)})`;
    case "user_reset_password":
      return `Reset the password for ${who(e.entity_id)}`;
    case "user_activate":
      return `Switched ${who(e.entity_id)} on`;
    case "user_deactivate":
      return `Switched ${who(e.entity_id)} off`;
    case "user_role_change":
      return `Changed ${who(e.entity_id)} to ${s(d.role)}`;
    default:
      return e.action.replaceAll("_", " ");
  }
}
