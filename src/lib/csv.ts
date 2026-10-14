/** One CSV cell. Cells that a spreadsheet could run as a formula are defused with a leading apostrophe. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type Column<T> = { header: string; value: (row: T) => unknown };

/** CSV with a BOM so Excel opens it as UTF-8, and Windows line endings. */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  return "﻿" + lines.join("\r\n");
}
