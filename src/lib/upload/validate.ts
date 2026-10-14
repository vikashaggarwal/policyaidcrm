import { parseDate } from "./dates";
import type { LeadField } from "./headers";
import { parsePhone } from "./phone";

export type RawRecord = Partial<Record<LeadField, string | number | null>>;

export type CleanLead = {
  state: string | null;
  reg_no: string;
  rto_code: string | null;
  reg_date: string | null;
  name: string;
  guardian_name: string | null;
  address: string | null;
  engine_no: string | null;
  chassis_no: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_class: string | null;
  fuel: string | null;
  sale_amount: number | null;
  seat_capacity: number | null;
  phone: string;
  city: string | null;
  product: string;
  source: string | null;
  /** what the sheet said in "assigned to"; resolved to a caller separately */
  assignee_text: string | null;
};

export type RowResult = { ok: true; lead: CleanLead } | { ok: false; reasons: string[] };

export const DEFAULT_PRODUCT = "Motor renewal";

function text(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/^'/, "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[₹,\s]|rs\.?/gi, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * The single source of truth for "is this row importable". Used in the browser for the preview
 * and again on the server before anything is written, so the two can never disagree.
 */
export function validateRow(raw: RawRecord): RowResult {
  const reasons: string[] = [];

  const phone = parsePhone(raw.phone);
  if (!phone.ok) reasons.push(phone.reason);

  const name = text(raw.name, 120);
  if (!name) reasons.push("Owner name is missing");

  const regNo = (text(raw.reg_no, 40) ?? "").toUpperCase().replace(/[\s\-._]/g, "");
  if (!regNo) reasons.push("Registration number is missing");
  else if (!/^[A-Z0-9]{4,15}$/.test(regNo)) reasons.push("Registration number looks wrong (4–15 letters and digits)");

  let regDate: string | null = null;
  const rawDate = raw.reg_date;
  if (rawDate !== null && rawDate !== undefined && String(rawDate).trim() !== "") {
    regDate = parseDate(rawDate);
    if (!regDate) reasons.push("Registration date isn't a date we can read (use DD/MM/YYYY)");
  }

  if (reasons.length > 0 || !phone.ok || !name) return { ok: false, reasons };

  const sale = num(raw.sale_amount);
  const seats = num(raw.seat_capacity);

  return {
    ok: true,
    lead: {
      state: text(raw.state, 60),
      reg_no: regNo,
      rto_code: text(raw.rto_code, 20)?.toUpperCase() ?? null,
      reg_date: regDate,
      name,
      guardian_name: text(raw.guardian_name, 120),
      address: text(raw.address, 500),
      engine_no: text(raw.engine_no, 40)?.toUpperCase() ?? null,
      chassis_no: text(raw.chassis_no, 40)?.toUpperCase() ?? null,
      vehicle_make: text(raw.vehicle_make, 80),
      vehicle_model: text(raw.vehicle_model, 120),
      vehicle_class: text(raw.vehicle_class, 60),
      fuel: text(raw.fuel, 30),
      sale_amount: sale !== null && sale >= 0 ? sale : null,
      seat_capacity: seats !== null && Number.isInteger(seats) && seats >= 0 && seats <= 200 ? seats : null,
      phone: phone.phone,
      city: text(raw.city, 80),
      product: text(raw.product, 60) ?? DEFAULT_PRODUCT,
      source: text(raw.source, 60),
      assignee_text: text(raw.assigned_to, 120),
    },
  };
}
