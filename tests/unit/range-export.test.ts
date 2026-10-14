import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { callLogColumns, leadColumns, type CallLogRow, type LeadRow } from "@/lib/export";
import { toXlsx } from "@/lib/export-xlsx";
import { resolveRange } from "@/lib/range";

// 15 Oct 2026, 10:00 IST
const NOW = new Date("2026-10-15T04:30:00Z");

describe("resolveRange (India days)", () => {
  it("today = IST midnight to IST midnight", () => {
    const r = resolveRange("today", undefined, undefined, NOW);
    expect(r.from).toBe("2026-10-14T18:30:00.000Z");
    expect(r.to).toBe("2026-10-15T18:30:00.000Z");
  });
  it("7 days includes today and the six before", () => {
    const r = resolveRange("7d", undefined, undefined, NOW);
    expect(r.from).toBe("2026-10-08T18:30:00.000Z"); // 9 Oct 00:00 IST
    expect(r.to).toBe("2026-10-15T18:30:00.000Z");
  });
  it("30 days", () => {
    expect(resolveRange("30d", undefined, undefined, NOW).from).toBe("2026-09-15T18:30:00.000Z"); // 16 Sep 00:00 IST
  });
  it("uses the IST date even when UTC is still yesterday", () => {
    const lateUtc = new Date("2026-10-14T20:00:00Z"); // 01:30 IST on the 15th
    expect(resolveRange("today", undefined, undefined, lateUtc).from).toBe("2026-10-14T18:30:00.000Z");
  });
  it("all time has no bounds", () => {
    expect(resolveRange("all", undefined, undefined, NOW)).toMatchObject({ from: null, to: null });
  });
  it("custom includes the whole last day", () => {
    const r = resolveRange("custom", "2026-10-01", "2026-10-03", NOW);
    expect(r.from).toBe("2026-09-30T18:30:00.000Z");
    expect(r.to).toBe("2026-10-03T18:30:00.000Z");
    expect(r.label).toBe("1 Oct 2026 – 3 Oct 2026");
    expect(r.notice).toBeUndefined();
  });
  it("a single custom day is one day", () => {
    const r = resolveRange("custom", "2026-10-03", "2026-10-03", NOW);
    expect(r.label).toBe("3 Oct 2026");
  });
  it.each([
    ["2026-10-05", "2026-10-01", /after the end/],
    [undefined, "2026-10-01", /both a start and an end/],
    ["2026-13-01", "2026-10-01", /both a start and an end/],
    ["2024-01-01", "2026-10-01", /longer than a year/],
  ])("falls back kindly on bad custom input (%s → %s)", (f, t, msg) => {
    const r = resolveRange("custom", f, t, NOW);
    expect(r.preset).toBe("7d");
    expect(r.notice).toMatch(msg);
  });
  it("unknown presets default to 7 days", () => {
    expect(resolveRange("bogus", undefined, undefined, NOW).preset).toBe("7d");
  });
});

const lead = (o: Partial<LeadRow> = {}): LeadRow => ({
  id: "1", state: "MAHARASHTRA", reg_no: "MH12AB0001", rto_code: "MH12", reg_date: "2026-09-10", name: "Demo, \"Owner\"",
  guardian_name: null, address: "1 Street\nPune", engine_no: null, chassis_no: "1234567890123456789", vehicle_make: "HONDA",
  vehicle_model: "ACTIVA", vehicle_class: null, fuel: "PETROL", sale_amount: 85000, seat_capacity: 2, phone: "9800000101",
  city: null, product: "Motor renewal", source: null, policy_expiry: "2026-09-15", assigned_to: "c1", status: "callback",
  callback_at: "2026-10-16T04:30:00.000Z", attempts: 2, last_called_at: null, dnd: false, created_at: "2026-10-01T00:00:00.000Z", ...o,
});

describe("exports", () => {
  const names = new Map([["c1", "Asha Verma"]]);

  it("CSV: sheet columns first, quoting right, IST times, caller names, BOM", () => {
    const csv = toCsv(leadColumns(names), [lead()]);
    expect(csv.startsWith("﻿STATE,REG NO,RTO CODE,REG DATE,OWNER NAME,OWNER(S/W/D),ADDRESS,ENGINE NO,CHASIS NO,")).toBe(true);
    const [head, row] = csv.slice(1).split("\r\n");
    expect(head.split(",").slice(0, 16).join(",")).toBe("STATE,REG NO,RTO CODE,REG DATE,OWNER NAME,OWNER(S/W/D),ADDRESS,ENGINE NO,CHASIS NO,VEHICLE MAKE,VEHICLE MODEL VARIANT,VEHICLE CLASS,FUEL,SALE AMOUNT,SEAT CAPACITY,MOBILE");
    expect(csv).toContain('"Demo, ""Owner"""'); // comma and quotes survive
    expect(csv).toContain('"1 Street\nPune"');   // newline survives inside quotes
    expect(csv).toContain("Asha Verma");
    expect(csv).toContain("2026-10-16 10:00");   // 04:30Z = 10:00 IST
    expect(csv).toContain(",Callback,");
    expect(row).toBeDefined();
  });

  it("CSV and XLSX defuse spreadsheet formulas", () => {
    const evil = lead({ name: "=HYPERLINK(\"http://evil\")", address: "@SUM(1)", source: "-2+3" });
    const csv = toCsv(leadColumns(names), [evil]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@SUM(1)");
    expect(csv).toContain("'-2+3");
    const wb = XLSX.read(toXlsx("Leads", leadColumns(names), [evil]), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Leads"]);
    expect(rows[0]["OWNER NAME"]).toBe("'=HYPERLINK(\"http://evil\")");
    expect(rows[0]["ADDRESS"]).toBe("'@SUM(1)");
  });

  it("XLSX: round-trips, phone and long IDs stay text, numbers stay numbers", () => {
    const wb = XLSX.read(toXlsx("Leads", leadColumns(names), [lead(), lead({ reg_no: "MH12AB0002", phone: "9800000102" })]), { type: "array" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Leads"], { raw: true });
    expect(rows).toHaveLength(2);
    expect(rows[0]["MOBILE"]).toBe("9800000101");
    expect(typeof rows[0]["MOBILE"]).toBe("string");
    expect(rows[0]["CHASIS NO"]).toBe("1234567890123456789");
    expect(rows[0]["SALE AMOUNT"]).toBe(85000);
    expect(rows[1]["REG NO"]).toBe("MH12AB0002");
  });

  it("call log export", () => {
    const row: CallLogRow = {
      id: "x", created_at: "2026-10-15T04:30:00.000Z", outcome: "no_answer", note: "rang twice", callback_at: null,
      caller_id: "c1", lead: { name: "Demo", phone: "9800000101", reg_no: "MH12AB0001" },
    };
    const csv = toCsv(callLogColumns(names), [row, { ...row, lead: null }]);
    expect(csv).toContain("CALLED AT (IST),CALLER,OWNER NAME,MOBILE,REG NO,OUTCOME,CALLBACK AT (IST),NOTE");
    expect(csv).toContain("2026-10-15 10:00,Asha Verma,Demo,9800000101,MH12AB0001,No answer,,rang twice");
  });

  it("an export can be uploaded straight back in: its headers are recognised", async () => {
    const { mapHeaders } = await import("@/lib/upload/headers");
    const m = mapHeaders(leadColumns(names).map((c) => c.header));
    expect(m.missingRequired).toEqual([]);
    expect(Object.keys(m.columns)).toEqual(expect.arrayContaining(["phone", "name", "reg_no", "assigned_to", "chassis_no", "vehicle_model"]));
  });
});
