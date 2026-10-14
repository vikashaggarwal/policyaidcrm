import * as XLSX from "xlsx";
import type { Column } from "@/lib/csv";

/** Excel file as bytes. Every phone/ID stays text so Excel can't turn it into 9.8E+09. */
export function toXlsx<T>(sheet: string, columns: Column<T>[], rows: T[]): Uint8Array {
  const aoa: unknown[][] = [columns.map((c) => c.header)];
  for (const r of rows) {
    aoa.push(columns.map((c) => {
      const v = c.value(r);
      if (v === null || v === undefined) return "";
      if (typeof v === "number") return v;
      const s = String(v);
      return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // defuse formulas, same as the CSV
    }));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(12, c.header.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
}
