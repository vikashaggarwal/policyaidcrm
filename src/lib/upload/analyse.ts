import { validateRow, type CleanLead, type RawRecord } from "./validate";
import type { MappedRow } from "./parse";

export type RowStatus = "new" | "duplicate" | "invalid";

export type AnalysedRow = {
  rowNumber: number;
  raw: RawRecord;
  status: RowStatus;
  /** why it's invalid, or where the duplicate came from */
  reasons: string[];
  lead?: CleanLead;
};

export type Counts = { total: number; new: number; duplicate: number; invalid: number };

/** Step 1 (instant, in the browser): validate every row and flag repeats inside the file. */
export function analyseLocally(rows: MappedRow[]): AnalysedRow[] {
  const seen = new Map<string, number>();
  return rows.map(({ rowNumber, raw }) => {
    const result = validateRow(raw);
    if (!result.ok) return { rowNumber, raw, status: "invalid", reasons: result.reasons };
    const first = seen.get(result.lead.reg_no);
    if (first !== undefined) {
      return {
        rowNumber, raw, status: "duplicate", lead: result.lead,
        reasons: [`Same registration number as row ${first} in this file`],
      };
    }
    seen.set(result.lead.reg_no, rowNumber);
    return { rowNumber, raw, status: "new", reasons: [], lead: result.lead };
  });
}

/** Step 2: after asking the server which registration numbers already exist, demote those to duplicates. */
export function applyExisting(rows: AnalysedRow[], existing: Set<string>): AnalysedRow[] {
  return rows.map((r) =>
    r.status === "new" && r.lead && existing.has(r.lead.reg_no)
      ? { ...r, status: "duplicate", reasons: ["Already in the system"] }
      : r,
  );
}

export function countRows(rows: AnalysedRow[]): Counts {
  const c: Counts = { total: rows.length, new: 0, duplicate: 0, invalid: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  // Stop spreadsheet formula injection when the file is reopened in Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of the rows that failed, with the reason in the first column, so they can be fixed and re-uploaded. */
export function invalidRowsCsv(rows: AnalysedRow[], fields: string[]): string {
  const bad = rows.filter((r) => r.status === "invalid");
  const lines = [["Row", "Problem", ...fields].map(csvCell).join(",")];
  for (const r of bad) {
    lines.push(
      [r.rowNumber, r.reasons.join("; "), ...fields.map((f) => (r.raw as Record<string, unknown>)[f])]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n"); // BOM so Excel opens it as UTF-8
}
