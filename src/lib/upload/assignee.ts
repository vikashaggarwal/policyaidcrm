export type CallerRef = { id: string; full_name: string; login_id: string };

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Matches the sheet's "assigned to" text against callers by login ID, email (the part before @)
 * or full name. Anything ambiguous or unknown returns null, which leaves the lead unassigned.
 */
export function resolveAssignee(text: string | null | undefined, callers: CallerRef[]): string | null {
  if (!text) return null;
  const t = squash(text);
  if (!t) return null;
  const local = t.includes("@") ? t.split("@")[0] : t;

  const byLogin = callers.filter((c) => c.login_id.toLowerCase() === local);
  if (byLogin.length === 1) return byLogin[0].id;

  const byName = callers.filter((c) => squash(c.full_name) === t);
  if (byName.length === 1) return byName[0].id;
  return null;
}
