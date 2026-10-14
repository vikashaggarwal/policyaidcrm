import { describe, expect, it } from "vitest";
import { parseDate } from "@/lib/upload/dates";
import { resolveAssignee } from "@/lib/upload/assignee";
import { analyseLocally, applyExisting, countRows, invalidRowsCsv } from "@/lib/upload/analyse";
import { validateRow } from "@/lib/upload/validate";

const good = { phone: "98000 00101", name: "  Demo   Owner ", reg_no: "mh-12 ab 1234" };

describe("parseDate", () => {
  it.each([
    ["15/01/2026", "2026-01-15"],
    ["5-3-2024", "2024-03-05"], // day first, Indian order
    ["15.01.26", "2026-01-15"],
    ["2026-01-15", "2026-01-15"],
    ["15-Jan-2026", "2026-01-15"],
    ["15 January 2026", "2026-01-15"],
    [46037, "2026-01-15"], // Excel serial
    ["46037", "2026-01-15"],
  ])("reads %j", (input, expected) => expect(parseDate(input)).toBe(expected));

  it.each([["31/02/2026"], ["13/13/2026"], ["hello"], [""], [null], ["15/01/1950"]])(
    "rejects %j", (input) => expect(parseDate(input)).toBeNull(),
  );
});

describe("validateRow", () => {
  it("cleans a good row", () => {
    const r = validateRow({ ...good, reg_date: "15/01/2026", sale_amount: "₹1,25,000", seat_capacity: "5" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lead).toMatchObject({
        phone: "9800000101", name: "Demo Owner", reg_no: "MH12AB1234", reg_date: "2026-01-15",
        sale_amount: 125000, seat_capacity: 5, product: "Motor renewal", assignee_text: null,
      });
    }
  });

  it("collects every reason, so one fix pass is enough", () => {
    const r = validateRow({ phone: "123", name: "", reg_no: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toHaveLength(3);
  });

  it("rejects an unreadable registration date but allows a missing one", () => {
    expect(validateRow({ ...good, reg_date: "soon" }).ok).toBe(false);
    expect(validateRow({ ...good }).ok).toBe(true);
  });

  it("drops junk in optional numeric fields instead of failing the row", () => {
    const r = validateRow({ ...good, sale_amount: "n/a", seat_capacity: "many" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lead.sale_amount).toBeNull();
  });
});

describe("analyseLocally", () => {
  const rows = [
    { rowNumber: 2, raw: { ...good } },
    { rowNumber: 3, raw: { phone: "9800000102", name: "B", reg_no: "MH12AB1234" } }, // same vehicle
    { rowNumber: 4, raw: { phone: "bad", name: "C", reg_no: "MH12AB5555" } },
    { rowNumber: 5, raw: { phone: "9800000101", name: "D", reg_no: "MH12AB9999" } }, // same phone, other vehicle: fine
  ];

  it("flags invalid rows and repeats inside the file", () => {
    const out = analyseLocally(rows);
    expect(out.map((r) => r.status)).toEqual(["new", "duplicate", "invalid", "new"]);
    expect(out[1].reasons[0]).toMatch(/row 2/);
  });

  it("demotes registration numbers already in the system", () => {
    const out = applyExisting(analyseLocally(rows), new Set(["MH12AB9999"]));
    expect(countRows(out)).toEqual({ total: 4, new: 1, duplicate: 2, invalid: 1 });
  });

  it("exports invalid rows as CSV with the reason, safe to reopen in Excel", () => {
    const out = analyseLocally([{ rowNumber: 7, raw: { phone: "+91 123", name: "=cmd()", reg_no: "X" } }]);
    const csv = invalidRowsCsv(out, ["phone", "name", "reg_no"]);
    expect(csv).toContain("Row,Problem,phone,name,reg_no");
    expect(csv).toContain("'+91 123");
    expect(csv).toContain("'=cmd()");
    expect(csv.split("\r\n")).toHaveLength(2);
  });
});

describe("resolveAssignee", () => {
  const callers = [
    { id: "1", full_name: "Asha Verma", login_id: "caller01" },
    { id: "2", full_name: "Ravi Kumar", login_id: "caller02" },
    { id: "3", full_name: "Ravi Kumar", login_id: "caller03" }, // same name: ambiguous
  ];
  it("matches by name, login ID or email", () => {
    expect(resolveAssignee("asha  verma", callers)).toBe("1");
    expect(resolveAssignee("CALLER02", callers)).toBe("2");
    expect(resolveAssignee("caller01@company.in", callers)).toBe("1");
  });
  it("leaves unknown or ambiguous names unassigned", () => {
    expect(resolveAssignee("Nobody", callers)).toBeNull();
    expect(resolveAssignee("Ravi Kumar", callers)).toBeNull();
    expect(resolveAssignee("", callers)).toBeNull();
    expect(resolveAssignee(null, callers)).toBeNull();
  });
});
