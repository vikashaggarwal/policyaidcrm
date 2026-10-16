import type { Column } from "@/lib/csv";
import { isoToIstLocal } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/outcomes";
import type { LeadStatus } from "@/lib/types";

/** "2026-10-15 14:30" in India time, the way a spreadsheet user expects to read it. */
export const istStamp = (iso: string | null | undefined) => (iso ? isoToIstLocal(iso).replace("T", " ") : "");
export const istDay = (iso: string | Date) => isoToIstLocal(iso).slice(0, 10);

export type LeadRow = {
  id: string; state: string | null; reg_no: string | null; rto_code: string | null; reg_date: string | null;
  name: string; guardian_name: string | null; address: string | null; engine_no: string | null;
  chassis_no: string | null; vehicle_make: string | null; vehicle_model: string | null;
  vehicle_class: string | null; fuel: string | null; sale_amount: number | null; seat_capacity: number | null;
  phone: string; city: string | null; product: string; source: string | null; renewal_date: string | null;
  assigned_to: string | null; status: LeadStatus; callback_at: string | null; attempts: number;
  last_called_at: string | null; dnd: boolean; created_at: string;
};

/** The sheet's own 16 columns first, in the sheet's order, so an export can be re-uploaded as is. */
export function leadColumns(callerNames: Map<string, string>): Column<LeadRow>[] {
  return [
    { header: "STATE", value: (r) => r.state },
    { header: "REG NO", value: (r) => r.reg_no },
    { header: "RTO CODE", value: (r) => r.rto_code },
    { header: "REG DATE", value: (r) => r.reg_date },
    { header: "OWNER NAME", value: (r) => r.name },
    { header: "OWNER(S/W/D)", value: (r) => r.guardian_name },
    { header: "ADDRESS", value: (r) => r.address },
    { header: "ENGINE NO", value: (r) => r.engine_no },
    { header: "CHASIS NO", value: (r) => r.chassis_no },
    { header: "VEHICLE MAKE", value: (r) => r.vehicle_make },
    { header: "VEHICLE MODEL VARIANT", value: (r) => r.vehicle_model },
    { header: "VEHICLE CLASS", value: (r) => r.vehicle_class },
    { header: "FUEL", value: (r) => r.fuel },
    { header: "SALE AMOUNT", value: (r) => r.sale_amount },
    { header: "SEAT CAPACITY", value: (r) => r.seat_capacity },
    { header: "MOBILE", value: (r) => r.phone },
    { header: "ASSIGNED TO", value: (r) => (r.assigned_to ? callerNames.get(r.assigned_to) ?? "" : "") },
    { header: "CITY", value: (r) => r.city },
    { header: "PRODUCT", value: (r) => r.product },
    { header: "SOURCE", value: (r) => r.source },
    { header: "RENEWAL DATE", value: (r) => r.renewal_date },
    { header: "STATUS", value: (r) => STATUS_LABEL[r.status] },
    { header: "CALLBACK AT (IST)", value: (r) => istStamp(r.callback_at) },
    { header: "CALL ATTEMPTS", value: (r) => r.attempts },
    { header: "LAST CALLED (IST)", value: (r) => istStamp(r.last_called_at) },
    { header: "DO NOT CALL", value: (r) => (r.dnd ? "Yes" : "No") },
    { header: "LOADED ON (IST)", value: (r) => istStamp(r.created_at) },
  ];
}

export type CallLogRow = {
  id: string; created_at: string; outcome: LeadStatus; note: string | null; callback_at: string | null;
  caller_id: string; lead: { name: string; phone: string; reg_no: string } | null;
};

export function callLogColumns(callerNames: Map<string, string>): Column<CallLogRow>[] {
  return [
    { header: "CALLED AT (IST)", value: (r) => istStamp(r.created_at) },
    { header: "CALLER", value: (r) => callerNames.get(r.caller_id) ?? "" },
    { header: "OWNER NAME", value: (r) => r.lead?.name },
    { header: "MOBILE", value: (r) => r.lead?.phone },
    { header: "REG NO", value: (r) => r.lead?.reg_no },
    { header: "OUTCOME", value: (r) => STATUS_LABEL[r.outcome] },
    { header: "CALLBACK AT (IST)", value: (r) => istStamp(r.callback_at) },
    { header: "NOTE", value: (r) => r.note },
  ];
}
