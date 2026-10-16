import type { LeadStatus } from "@/lib/types";

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  no_answer: "No answer",
  callback: "Callback",
  interested: "Interested",
  sold: "Sold",
  not_interested: "Not interested",
  do_not_call: "Do not call",
};

/** Colour is never the only signal: every badge also carries its label. */
export const STATUS_STYLE: Record<LeadStatus, string> = {
  new: "bg-primary/15 text-primary-deep",
  no_answer: "bg-warn-bg",
  callback: "bg-warn-bg",
  interested: "bg-ok-bg text-ok",
  sold: "bg-ok-bg text-ok",
  not_interested: "bg-line text-muted",
  do_not_call: "bg-danger-bg text-danger",
};

/** What a caller can record after a call (never "new"). */
export type Outcome = Exclude<LeadStatus, "new">;

export const OUTCOMES: { value: Outcome; label: string; hint: string }[] = [
  { value: "no_answer", label: "No answer", hint: "Didn't pick up, busy or switched off" },
  { value: "callback", label: "Call back", hint: "Asked to be called later" },
  { value: "interested", label: "Interested", hint: "Wants a quote or to think" },
  { value: "sold", label: "Sold", hint: "Policy purchased" },
  { value: "not_interested", label: "Not interested", hint: "Declined" },
  { value: "do_not_call", label: "Do not call", hint: "Asked never to be called" },
];
