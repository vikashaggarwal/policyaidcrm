import { parseDate } from "@/lib/upload/dates";
import { parsePhone } from "@/lib/upload/phone";

export const NEW_LEAD_FIELDS = [
  "name", "phone", "guardian_name", "reg_no", "reg_date", "renewal_date", "vehicle_make", "vehicle_model", "vehicle_class",
  "fuel", "city", "state", "rto_code", "address", "engine_no", "chassis_no", "sale_amount", "seat_capacity",
] as const;
export type NewLeadField = (typeof NEW_LEAD_FIELDS)[number];
export type NewLeadForm = Partial<Record<NewLeadField, string>>;
export type FieldErrors = Partial<Record<NewLeadField, string>>;

export type NewLeadResult =
  | { ok: true; payload: Record<string, string | number | null> }
  | { ok: false; errors: FieldErrors };

const clean = (v: string | undefined, max: number) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Only name and mobile are compulsory. Optional fields that are filled in must still be sensible. */
export function validateNewLead(form: NewLeadForm): NewLeadResult {
  const errors: FieldErrors = {};

  const name = clean(form.name, 120);
  if (!name) errors.name = "Enter the person's name.";

  const phone = parsePhone((form.phone ?? "").trim());
  if (!phone.ok) {
    errors.phone = phone.reason === "Mobile number is missing"
      ? "Enter the mobile number."
      : /scientific/.test(phone.reason) ? "That number looks cut off. Type all 10 digits." : `${phone.reason}.`;
  }

  const regNo = clean(form.reg_no, 40).toUpperCase().replace(/[\s\-._]/g, "");
  if (regNo && !/^[A-Z0-9]{4,15}$/.test(regNo)) errors.reg_no = "Use 4–15 letters and digits, e.g. MH12AB1234.";

  let regDate: string | null = null;
  if (clean(form.reg_date, 20)) {
    regDate = parseDate(clean(form.reg_date, 20));
    if (!regDate) errors.reg_date = "Use a real date, e.g. 15/01/2026.";
  }

  let renewal: string | null = null;
  if (clean(form.renewal_date, 20)) {
    renewal = parseDate(clean(form.renewal_date, 20));
    if (!renewal) errors.renewal_date = "Use a real date, e.g. 15/01/2027.";
  }

  let sale: number | null = null;
  if (clean(form.sale_amount, 20)) {
    const n = Number(clean(form.sale_amount, 20).replace(/[₹,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 1e12) errors.sale_amount = "Enter the amount as a number.";
    else sale = n;
  }

  let seats: number | null = null;
  if (clean(form.seat_capacity, 5)) {
    const n = Number(clean(form.seat_capacity, 5));
    if (!Number.isInteger(n) || n < 0 || n > 200) errors.seat_capacity = "Enter a whole number of seats.";
    else seats = n;
  }

  if (Object.keys(errors).length > 0 || !phone.ok) return { ok: false, errors };

  const opt = (v: string | undefined, max: number) => clean(v, max) || null;
  return {
    ok: true,
    payload: {
      name, phone: phone.phone, reg_no: regNo || null, reg_date: regDate, renewal_date: renewal,
      guardian_name: opt(form.guardian_name, 120), vehicle_make: opt(form.vehicle_make, 80),
      vehicle_model: opt(form.vehicle_model, 120), vehicle_class: opt(form.vehicle_class, 60), fuel: opt(form.fuel, 30),
      city: opt(form.city, 80), state: opt(form.state, 60), rto_code: opt(form.rto_code, 20),
      address: opt(form.address, 500), engine_no: opt(form.engine_no, 40), chassis_no: opt(form.chassis_no, 40),
      sale_amount: sale, seat_capacity: seats,
    },
  };
}
