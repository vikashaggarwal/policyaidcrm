export type Role = "admin" | "manager" | "caller";

export type LeadStatus =
  | "new"
  | "no_answer"
  | "message_sent"
  | "callback"
  | "interested"
  | "sold"
  | "not_interested"
  | "wrong_number"
  | "do_not_call";

export type Profile = {
  id: string;
  login_id: string;
  full_name: string;
  role: Role;
  active: boolean;
  created_at: string;
};

export const isStaff = (role: Role) => role === "admin" || role === "manager";
