export const LEAD_FIELDS = [
  "state", "reg_no", "rto_code", "reg_date", "name", "guardian_name", "address",
  "engine_no", "chassis_no", "vehicle_make", "vehicle_model", "vehicle_class",
  "fuel", "sale_amount", "seat_capacity", "phone",
  "city", "product", "source", "assigned_to",
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export const REQUIRED_FIELDS: LeadField[] = ["phone", "name", "reg_no"];

export const FIELD_LABELS: Record<LeadField, string> = {
  state: "State", reg_no: "Registration no.", rto_code: "RTO code", reg_date: "Registration date",
  name: "Owner name", guardian_name: "Owner (S/W/D)", address: "Address", engine_no: "Engine no.",
  chassis_no: "Chassis no.", vehicle_make: "Vehicle make", vehicle_model: "Model / variant",
  vehicle_class: "Vehicle class", fuel: "Fuel", sale_amount: "Sale amount", seat_capacity: "Seat capacity",
  phone: "Mobile", city: "City", product: "Product", source: "Source", assigned_to: "Assigned to",
};

// Aliases are compared after normalising: lower-case, letters and digits only.
const ALIASES: Record<LeadField, string[]> = {
  phone: ["mobile", "mobileno", "mobilenumber", "mobno", "phone", "phoneno", "phonenumber", "contact", "contactno", "contactnumber", "cell", "cellno", "whatsapp", "mobile1"],
  name: ["ownername", "name", "customername", "customer", "fullname", "owner", "clientname"],
  guardian_name: ["ownerswd", "guardian", "guardianname", "fathername", "relativename", "swd", "sdw", "sonwifedaughterof"],
  reg_no: ["regno", "registrationno", "registrationnumber", "vehicleno", "vehiclenumber", "regnumber", "vehicleregno", "regnoofvehicle"],
  reg_date: ["regdate", "registrationdate", "dateofregistration", "dateofreg"],
  rto_code: ["rtocode", "rto", "rtoname"],
  state: ["state", "statename"],
  address: ["address", "addr", "owneraddress", "fulladdress"],
  engine_no: ["engineno", "enginenumber", "engno"],
  chassis_no: ["chassisno", "chasisno", "chassisnumber", "chasisnumber", "chassis", "vin"],
  vehicle_make: ["vehiclemake", "make", "manufacturer", "brand"],
  vehicle_model: ["vehiclemodelvariant", "vehiclemodel", "model", "variant", "modelvariant"],
  vehicle_class: ["vehicleclass", "class", "vehicletype", "category"],
  fuel: ["fuel", "fueltype"],
  sale_amount: ["saleamount", "amount", "saleprice", "price", "invoicevalue", "exshowroom"],
  seat_capacity: ["seatcapacity", "seats", "seatingcapacity", "seat"],
  city: ["city", "town", "district"],
  product: ["product", "policytype", "producttype"],
  source: ["source", "leadsource", "datasource"],
  assigned_to: ["assignedto", "assign", "assignee", "caller", "callername", "telecaller", "agent", "assignedcaller"],
};

export const normaliseHeader = (h: unknown) =>
  String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const EXACT = new Map<string, LeadField>();
for (const f of LEAD_FIELDS) for (const a of ALIASES[f]) if (!EXACT.has(a)) EXACT.set(a, f);

/** Matches one header to a field. Exact alias first; then a unique prefix (covers cut-off headers like "OWNER NAM"). */
export function matchHeader(header: unknown): LeadField | null {
  const n = normaliseHeader(header);
  if (!n) return null;
  const exact = EXACT.get(n);
  if (exact) return exact;
  if (n.length < 5) return null;
  const hits = new Set<LeadField>();
  for (const [alias, field] of EXACT) if (alias.startsWith(n)) hits.add(field);
  return hits.size === 1 ? [...hits][0] : null;
}

export type HeaderMapping = {
  /** field -> column index */
  columns: Partial<Record<LeadField, number>>;
  /** columns we could not place, so the manager can see what was ignored */
  ignored: string[];
  missingRequired: LeadField[];
};

export function mapHeaders(headers: unknown[]): HeaderMapping {
  const columns: Partial<Record<LeadField, number>> = {};
  const ignored: string[] = [];
  headers.forEach((h, i) => {
    const text = String(h ?? "").trim();
    if (!text) return;
    const field = matchHeader(text);
    if (field && columns[field] === undefined) columns[field] = i;
    else ignored.push(text);
  });
  return { columns, ignored, missingRequired: REQUIRED_FIELDS.filter((f) => columns[f] === undefined) };
}
