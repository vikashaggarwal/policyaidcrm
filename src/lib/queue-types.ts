import type { LeadStatus } from "@/lib/types";

export const PAGE_SIZE = 30;

export type QueueFilter = "todo" | "due" | "new" | "no_answer" | "callbacks" | "interested" | "closed";

export const FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "due", label: "Due now" },
  { value: "new", label: "New" },
  { value: "no_answer", label: "No answer" },
  { value: "callbacks", label: "Callbacks" },
  { value: "interested", label: "Interested" },
  { value: "closed", label: "Closed" },
];

export type QueueRow = {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  reg_no: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  status: LeadStatus;
  callback_at: string | null;
  attempts: number;
  last_called_at: string | null;
  renewal_date: string | null;
  bucket: number;
  total_count: number;
};

export type QueueCounts = Record<QueueFilter, number>;

export const EMPTY_COUNTS: QueueCounts = { todo: 0, due: 0, new: 0, no_answer: 0, callbacks: 0, interested: 0, closed: 0 };

export const toCounts = (row: Record<string, unknown> | null | undefined): QueueCounts => ({
  todo: Number(row?.todo ?? 0),
  due: Number(row?.due ?? 0),
  new: Number(row?.new ?? 0),
  no_answer: Number(row?.no_answer ?? 0),
  callbacks: Number(row?.callbacks ?? 0),
  interested: Number(row?.interested ?? 0),
  closed: Number(row?.closed ?? 0),
});

export type LeadDetail = {
  id: string; name: string; guardian_name: string | null; phone: string; reg_no: string | null;
  reg_date: string | null; renewal_date: string | null; state: string | null; rto_code: string | null;
  address: string | null; city: string | null; engine_no: string | null; chassis_no: string | null;
  vehicle_make: string | null; vehicle_model: string | null; vehicle_class: string | null; fuel: string | null;
  sale_amount: number | null; seat_capacity: number | null; product: string; source: string | null;
  status: LeadStatus; callback_at: string | null; attempts: number; last_called_at: string | null;
};

export type HistoryItem = {
  id: string; outcome: LeadStatus; note: string | null; callback_at: string | null;
  created_at: string; caller_name: string;
};

export type OtherVehicle = { reg_no: string | null; vehicle_make: string | null; vehicle_model: string | null; status: LeadStatus };
