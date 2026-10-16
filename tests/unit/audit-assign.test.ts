import { describe, expect, it } from "vitest";
import { describeAudit, type AuditEntry } from "@/lib/audit";
import { analyseLocally, summariseAssignments } from "@/lib/upload/analyse";

const callers = [
  { id: "c1", full_name: "Asha Verma", login_id: "caller01" },
  { id: "c2", full_name: "Ravi Kumar", login_id: "caller02" },
];
const row = (n: number, assigned?: string) => ({
  rowNumber: n, raw: { reg_no: `MH12AB${1000 + n}`, name: `Owner ${n}`, phone: `98000001${String(n).padStart(2, "0")}`, assigned_to: assigned ?? null },
});

describe("summariseAssignments (assignment typed in the Excel)", () => {
  it("shows who gets what, what's blank, and the names that matched nobody", () => {
    const rows = analyseLocally([
      row(1, "Asha Verma"), row(2, "asha  VERMA"), row(3, "caller02"), row(4, "caller01@dialdesk.app"),
      row(5),
      row(6, "Ashaa Verma"), row(7, "Ashaa Verma"), row(8, "Nobody"),
    ]);
    const s = summariseAssignments(rows, callers);
    expect(s.perCaller).toEqual([
      { id: "c1", name: "Asha Verma", count: 3 }, // by name, by name (case/spacing), by login-ID email
      { id: "c2", name: "Ravi Kumar", count: 1 }, // by login ID
    ]);
    expect(s.unassignedBlank).toBe(1);
    expect(s.unmatched).toEqual([{ text: "Ashaa Verma", count: 2 }, { text: "Nobody", count: 1 }]);
    expect(s.unmatchedTotal).toBe(3);
  });

  it("ignores duplicates and invalid rows: only leads that will actually import", () => {
    const rows = analyseLocally([
      row(1, "Asha Verma"),
      { rowNumber: 2, raw: { ...row(1, "Asha Verma").raw } }, // same vehicle: duplicate
      { rowNumber: 3, raw: { reg_no: "MH12AB9999", name: "X", phone: "bad", assigned_to: "Asha Verma" } }, // invalid
    ]);
    expect(summariseAssignments(rows, callers).perCaller).toEqual([{ id: "c1", name: "Asha Verma", count: 1 }]);
  });
});

describe("describeAudit", () => {
  const names = new Map([["c1", "Asha Verma"], ["m1", "Manager"]]);
  const e = (action: string, details: Record<string, unknown>, extra: Partial<AuditEntry> = {}): AuditEntry =>
    ({ id: 1, actor_id: "m1", action, entity: "x", entity_id: null, details, created_at: "2026-10-15T04:30:00Z", ...extra });

  it.each([
    [e("upload", { filename: "oct.xlsx", added: 1200, duplicates: 30, invalid: 4, total_rows: 1234 }), "Uploaded “oct.xlsx”: 1,200 added, 30 duplicates, 4 invalid (1,234 rows)"],
    [e("reassign", { count: 1, to: "c1" }), "Reassigned 1 lead to Asha Verma"],
    [e("reassign", { count: 50, to: null }), "Reassigned 50 leads to nobody (unassigned)"],
    [e("reassign_unworked", { count: 7, from: "c1", to: "gone" }), "Moved 7 unworked leads from Asha Verma to a removed user"],
    [e("delete_lead", { reg_no: "MH12AB0001" }), "Deleted lead MH12AB0001"],
    [e("export", { rows: 25000, format: "xlsx" }, { entity_id: "leads" }), "Exported 25,000 leads as XLSX"],
    [e("export", { rows: 10, format: "csv" }, { entity_id: "call_logs" }), "Exported 10 call log rows as CSV"],
    [e("user_deactivate", {}, { entity_id: "c1" }), "Switched Asha Verma off"],
    [e("wrong_number", { reg_no: "MH12AB0001" }), "Marked MH12AB0001 as a wrong number"],
    [e("reopen_leads", { count: 1 }), "Reopened 1 wrong-number lead"],
    [e("reopen_leads", { count: 4 }), "Reopened 4 wrong-number leads"],
    [e("something_new", {}), "something new"],
  ])("%#", (entry, text) => expect(describeAudit(entry, names)).toBe(text));
});
