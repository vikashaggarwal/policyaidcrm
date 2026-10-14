export type PhoneResult = { ok: true; phone: string } | { ok: false; reason: string };

const SCI = /^[+-]?(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;

/**
 * Normalises an Indian mobile number to exactly 10 digits.
 * Handles Excel numbers, scientific notation, spaces/dashes, +91, 91 and a leading 0.
 */
export function parsePhone(value: unknown): PhoneResult {
  if (value === null || value === undefined || value === "") {
    return { ok: false, reason: "Mobile number is missing" };
  }

  let digits: string;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value >= 1e15) {
      return { ok: false, reason: "Mobile number isn't a valid number" };
    }
    digits = String(value);
  } else {
    // Several numbers in one cell ("98.. / 97.."): use the first.
    let s = String(value).trim().replace(/^'/, "").split(/[\/,;\n|]/)[0].trim();
    if (!s) return { ok: false, reason: "Mobile number is missing" };

    const sci = s.replace(/\s/g, "").match(SCI);
    if (sci) {
      const [, whole, frac = "", exp] = sci;
      const mantissaDigits = (whole + frac).length;
      const e = Number(exp);
      // "9.8E+09" has thrown the real digits away; only accept if nothing was lost.
      if (e < 0 || mantissaDigits < e + 1) {
        return { ok: false, reason: "Number was turned into scientific notation by Excel (digits lost). Format the column as Text and re-export" };
      }
      digits = (whole + frac).padEnd(e + 1, "0").slice(0, e + 1);
    } else {
      s = s.replace(/\.0+$/, ""); // "9800000101.0"
      digits = s.replace(/[\s\-().]/g, "");
      if (digits.startsWith("+")) digits = digits.slice(1);
      if (!/^\d+$/.test(digits)) return { ok: false, reason: "Mobile number has letters or symbols" };
    }
  }

  if (digits.length === 14 && digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length !== 10) {
    return { ok: false, reason: `Mobile number has ${digits.length} digits; it needs exactly 10` };
  }
  if (!/^[6-9]/.test(digits)) {
    return { ok: false, reason: "Mobile number doesn't start with 6, 7, 8 or 9" };
  }
  return { ok: true, phone: digits };
}

export function normalisePhone(value: unknown): string | null {
  const r = parsePhone(value);
  return r.ok ? r.phone : null;
}
