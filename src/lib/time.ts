// Everything the team sees and picks is Indian Standard Time (UTC+5:30, no daylight saving),
// whatever the phone's own time zone says. The database stores UTC.
const IST_MS = 330 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-15T14:30" typed in the picker (as IST) -> ISO UTC string. Null if unreadable. */
export function istLocalToIso(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - IST_MS;
  const check = new Date(ms + IST_MS);
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null; // e.g. 31 Feb
  return new Date(ms).toISOString();
}

/** ISO UTC -> "YYYY-MM-DDTHH:mm" in IST, for the picker's value and min. */
export function isoToIstLocal(iso: string | number | Date): string {
  const d = new Date(new Date(iso).getTime() + IST_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata",
});
const dateOnly = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export const formatIst = (iso: string | Date) => dateTime.format(new Date(iso)).replace(/\b(am|pm)\b/i, (s) => s.toLowerCase());
export const formatDate = (iso: string | Date) => dateOnly.format(new Date(iso));

/** "Due 25 min ago", "Due in 2 h", or the date for anything further out. */
export function describeCallback(iso: string, now: Date = new Date()): { text: string; due: boolean } {
  const diffMin = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (diffMin <= 0) {
    const ago = -diffMin;
    if (ago < 1) return { text: "Due now", due: true };
    if (ago < 60) return { text: `Overdue ${ago} min`, due: true };
    if (ago < 1440) return { text: `Overdue ${Math.floor(ago / 60)} h`, due: true };
    return { text: `Overdue ${Math.floor(ago / 1440)} d`, due: true };
  }
  if (diffMin < 60) return { text: `In ${diffMin} min`, due: false };
  if (diffMin < 1440) return { text: `In ${Math.floor(diffMin / 60)} h · ${formatIst(iso)}`, due: false };
  return { text: formatIst(iso), due: false };
}

export type Preset = { label: string; iso: string };

/** Quick callback choices, always in the future, computed on the IST clock. */
export function callbackPresets(now: Date = new Date()): Preset[] {
  const ist = new Date(now.getTime() + IST_MS);
  const at = (dayOffset: number, hour: number) =>
    new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, hour, 0) - IST_MS);
  const out: Preset[] = [{ label: "In 1 hour", iso: new Date(now.getTime() + 3_600_000).toISOString() }];
  const evening = at(0, 17);
  if (evening.getTime() - now.getTime() > 2 * 3_600_000) out.push({ label: "Today 5 pm", iso: evening.toISOString() });
  out.push({ label: "Tomorrow 10 am", iso: at(1, 10).toISOString() });
  out.push({ label: "In 3 days, 10 am", iso: at(3, 10).toISOString() });
  return out;
}
