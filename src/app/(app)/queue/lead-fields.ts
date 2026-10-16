import type { NewLeadField } from "@/lib/new-lead";

export type FieldDef = {
  name: NewLeadField; label: string; type?: string;
  inputMode?: "numeric" | "decimal" | "text" | "tel"; placeholder?: string; wide?: boolean;
};

/** Every detail except name and mobile, in the order a caller reads them. Shared by Add lead and Edit details. */
export const DETAIL_FIELDS: FieldDef[] = [
  { name: "guardian_name", label: "Owner (S/W/D)" },
  { name: "reg_no", label: "Registration no.", placeholder: "MH12AB1234" },
  { name: "reg_date", label: "Registration date", type: "date" },
  { name: "renewal_date", label: "Renewal date", type: "date" },
  { name: "vehicle_make", label: "Vehicle make", placeholder: "e.g. Honda" },
  { name: "vehicle_model", label: "Model / variant", placeholder: "e.g. Activa 6G" },
  { name: "vehicle_class", label: "Vehicle class" },
  { name: "fuel", label: "Fuel" },
  { name: "seat_capacity", label: "Seat capacity", inputMode: "numeric" },
  { name: "sale_amount", label: "Sale amount (₹)", inputMode: "decimal" },
  { name: "city", label: "City" },
  { name: "state", label: "State" },
  { name: "rto_code", label: "RTO code", placeholder: "MH12" },
  { name: "engine_no", label: "Engine no." },
  { name: "chassis_no", label: "Chassis no." },
  { name: "address", label: "Address", wide: true },
];
