/** Turns database error codes (raised by our SQL functions) into plain sentences a caller can act on. */
const MESSAGES: Record<string, string> = {
  not_allowed: "You don't have permission to do that.",
  lead_not_found: "That lead is no longer available. Refresh your queue.",
  lead_blocked: "This number is on the do-not-call list, so it can't be called.",
  invalid_outcome: "Choose how the call went.",
  note_too_long: "Your note is too long. Keep it under 1,000 characters.",
  callback_required: "Pick a date and time for the callback.",
  callback_in_past: "The callback time has already passed. Pick a time in the future.",
  invalid_selection: "Select at least one lead first (and no more than 5,000 at a time).",
  invalid_target: "Choose an active caller to give these leads to.",
  invalid_upload: "That upload isn't valid. Check the file and try again.",
  already_finished: "This upload was already completed. Start a new upload.",
  dnd_locked: "Do-not-call can only be lifted by an admin.",
  name_required: "Enter the person's name.",
  invalid_phone: "Enter a valid 10-digit mobile number (starting with 6, 7, 8 or 9).",
  invalid_reg_no: "That registration number doesn't look right. Use 4–15 letters and digits.",
  invalid_date: "That registration date isn't valid. Use DD/MM/YYYY.",
  duplicate_phone: "This mobile number is already in the system. Search for it in your queue, or add a registration number if it's a different vehicle.",
  duplicate_vehicle: "That registration number is already in the system.",
  invalid_export: "That export isn't available.",
  append_only: "Call history can't be changed.",
};

export const GENERIC_ERROR = "Something went wrong on our side. Please try again in a moment.";

export function friendlyError(error: { message?: string } | null | undefined): string {
  const msg = error?.message ?? "";
  for (const [code, text] of Object.entries(MESSAGES)) if (msg.includes(code)) return text;
  if (/fetch|network|timeout/i.test(msg)) return "We couldn't reach the server. Check your internet and try again.";
  return GENERIC_ERROR;
}
