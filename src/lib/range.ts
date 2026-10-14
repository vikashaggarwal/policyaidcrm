// Date ranges for the dashboard and exports. "Today" means today in India, not on the server.
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

export type RangePreset = "today" | "7d" | "30d" | "all" | "custom";

export type ResolvedRange = {
  preset: RangePreset;
  /** inclusive start, as an ISO instant; null = no lower bound */
  from: string | null;
  /** exclusive end; null = no upper bound */
  to: string | null;
  label: string;
  /** set when the request was unusable and we fell back to a sensible default */
  notice?: string;
  /** echo for the custom form */
  fromDate?: string;
  toDate?: string;
};

/** Midnight IST (as a UTC ms timestamp) of the day containing `ms`, shifted by `dayOffset` days. */
function istMidnight(ms: number, dayOffset = 0): number {
  const shifted = ms + IST_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS + dayOffset * DAY_MS - IST_MS;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function parseDay(s: string | undefined): number | null {
  const m = s?.match(DATE);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d);
  const chk = new Date(t);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return t - IST_MS; // midnight IST of that calendar day
}

const fmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const label = (fromMs: number, toExclusiveMs: number) => {
  const a = fmt.format(new Date(fromMs));
  const b = fmt.format(new Date(toExclusiveMs - 1));
  return a === b ? a : `${a} – ${b}`;
};

export const MAX_CUSTOM_DAYS = 366;

export function resolveRange(
  preset: string | undefined, fromDate?: string, toDate?: string, now: Date = new Date(),
): ResolvedRange {
  const nowMs = now.getTime();
  const tomorrow = istMidnight(nowMs, 1);

  if (preset === "all") return { preset: "all", from: null, to: null, label: "All time" };
  if (preset === "today") {
    const start = istMidnight(nowMs);
    return { preset: "today", from: new Date(start).toISOString(), to: new Date(tomorrow).toISOString(), label: "Today" };
  }
  if (preset === "30d") {
    const start = istMidnight(nowMs, -29);
    return { preset: "30d", from: new Date(start).toISOString(), to: new Date(tomorrow).toISOString(), label: "Last 30 days" };
  }
  if (preset === "custom") {
    const f = parseDay(fromDate);
    const t = parseDay(toDate);
    if (f !== null && t !== null && f <= t && (t - f) / DAY_MS < MAX_CUSTOM_DAYS) {
      const toExclusive = t + DAY_MS;
      return {
        preset: "custom", from: new Date(f).toISOString(), to: new Date(toExclusive).toISOString(),
        label: label(f, toExclusive), fromDate, toDate,
      };
    }
    const fallback = resolveRange("7d", undefined, undefined, now);
    return {
      ...fallback,
      notice: f === null || t === null
        ? "Pick both a start and an end date. Showing the last 7 days."
        : f > t
          ? "The start date is after the end date. Showing the last 7 days."
          : "That range is longer than a year. Showing the last 7 days.",
    };
  }
  // default and "7d"
  const start = istMidnight(nowMs, -6);
  return { preset: "7d", from: new Date(start).toISOString(), to: new Date(tomorrow).toISOString(), label: "Last 7 days" };
}
