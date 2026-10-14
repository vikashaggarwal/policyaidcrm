const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function iso(y: number, m: number, d: number): string | null {
  if (y < 1980 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

const fullYear = (yy: number) => (yy >= 100 ? yy : yy <= 49 ? 2000 + yy : 1900 + yy);

/** Parses registration dates to YYYY-MM-DD. Indian day-first order; also Excel serial numbers. */
export function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  const asSerial = (n: number) => {
    if (!Number.isFinite(n) || n < 10000 || n > 80000) return null;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  };

  if (typeof value === "number") return asSerial(value);

  const s = String(value).trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return asSerial(Number(s));

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) return iso(fullYear(+m[3]), +m[2], +m[1]);

  m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.,]+(\d{2,4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi < 0 ? null : iso(fullYear(+m[3]), mi + 1, +m[1]);
  }
  return null;
}
