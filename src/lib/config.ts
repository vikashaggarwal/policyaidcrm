// Callers type a login ID (e.g. "caller07"). Supabase Auth needs an email, so we derive one.
// Nothing is ever sent to this address. Use a domain you own (it only has to exist).
export const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dialdesk.app";

export const LOGIN_ID_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normaliseLoginId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function loginIdToEmail(loginId: string): string {
  return `${normaliseLoginId(loginId)}@${LOGIN_DOMAIN}`;
}
