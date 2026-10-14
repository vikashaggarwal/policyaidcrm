import { mapHeaders, type HeaderMapping } from "./headers";
import type { RawRecord } from "./validate";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 30_000;
/** Rows sent to the server per request during import. */
export const CHUNK_SIZE = 500;

export type Table = { headers: unknown[]; rows: unknown[][] };

export class UploadError extends Error {}

type XLSXModule = typeof import("xlsx");

function sheetToTable(XLSX: XLSXModule, wb: import("xlsx").WorkBook): Table {
  const name = wb.SheetNames[0];
  if (!name) throw new UploadError("That file has no sheets in it.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
    header: 1, raw: true, defval: "", blankrows: false,
  });
  // The header is the first row (within the top 10) that has at least two filled cells.
  const headerIdx = grid.slice(0, 10).findIndex((r) => r.filter((c) => String(c).trim() !== "").length >= 2);
  if (headerIdx < 0) throw new UploadError("We couldn't find a header row. The first row should name each column.");
  const rows = grid.slice(headerIdx + 1).filter((r) => r.some((c) => String(c).trim() !== ""));
  return { headers: grid[headerIdx], rows };
}

/** Reads .xlsx, .xls or .csv (first sheet only). Runs in the browser; the file never leaves the device unparsed. */
export async function readFile(file: File): Promise<Table> {
  if (file.size > MAX_FILE_BYTES) throw new UploadError("That file is over 10 MB. Split it into smaller files.");
  const lower = file.name.toLowerCase();
  const XLSX = await import("xlsx");
  try {
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      // raw: keep every cell as text so long IDs and phone numbers are not re-interpreted
      return sheetToTable(XLSX, XLSX.read(await file.text(), { type: "string", raw: true }));
    }
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      return sheetToTable(XLSX, XLSX.read(await file.arrayBuffer(), { type: "array" }));
    }
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("We couldn't read that file. Make sure it isn't password-protected or damaged.");
  }
  throw new UploadError("Upload an Excel (.xlsx, .xls) or CSV file.");
}

/** Pasted rows from Excel (tab-separated) or a CSV (comma-separated). First line = headers. */
export async function readPasted(text: string): Promise<Table> {
  const trimmed = text.trim();
  if (!trimmed) throw new UploadError("Paste your rows first, including the header row.");
  const XLSX = await import("xlsx");
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  const FS = firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";
  try {
    return sheetToTable(XLSX, XLSX.read(trimmed, { type: "string", raw: true, FS }));
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("We couldn't read the pasted rows. Copy the header row and the data together.");
  }
}

export type MappedRow = { rowNumber: number; raw: RawRecord };

export function mapRows(table: Table): { mapping: HeaderMapping; rows: MappedRow[] } {
  if (table.rows.length > MAX_ROWS) {
    throw new UploadError(`That file has ${table.rows.length.toLocaleString("en-IN")} rows. Upload up to ${MAX_ROWS.toLocaleString("en-IN")} at a time.`);
  }
  const mapping = mapHeaders(table.headers);
  const entries = Object.entries(mapping.columns) as [keyof RawRecord, number][];
  const rows = table.rows.map((cells, i) => {
    const raw: RawRecord = {};
    for (const [field, col] of entries) {
      const v = cells[col];
      raw[field] = typeof v === "number" || typeof v === "string" ? v : v == null ? null : String(v);
    }
    return { rowNumber: i + 2, raw }; // +2: spreadsheet row 1 is the header
  });
  return { mapping, rows };
}
