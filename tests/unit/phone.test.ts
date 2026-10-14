import { describe, expect, it } from "vitest";
import { normalisePhone, parsePhone } from "@/lib/upload/phone";

describe("normalisePhone", () => {
  it.each([
    ["9800000101", "9800000101"],
    ["98000 00101", "9800000101"],
    ["98000-00101", "9800000101"],
    ["+91 98000 00101", "9800000101"],
    ["+919800000101", "9800000101"],
    ["919800000101", "9800000101"],
    ["09800000101", "9800000101"],
    ["0091 9800000101", "9800000101"],
    ["(98000) 00101", "9800000101"],
    ["9800000101.0", "9800000101"],
    ["'+91 9800000101", "9800000101"], // apostrophe added by our own CSV export
    ["9800000101 / 9811111111", "9800000101"], // two numbers: first wins
    [9800000101, "9800000101"], // Excel stored it as a number
    [919800000101, "9800000101"],
  ])("accepts %j", (input, expected) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it("recovers scientific notation only when no digits were lost", () => {
    expect(normalisePhone("9.800000101E+9")).toBe("9800000101");
    expect(normalisePhone("9.800000101e9")).toBe("9800000101");
    // "9.8E+09" is what Excel shows for a narrow column: the real digits are gone
    const lost = parsePhone("9.8E+09");
    expect(lost.ok).toBe(false);
    if (!lost.ok) expect(lost.reason).toMatch(/scientific notation/i);
  });

  it.each([
    [null], [undefined], [""], ["   "], ["12345"], ["98000001011"], ["98000001"],
    ["abcdefghij"], ["98000x0101"], ["5800000101"], ["0000000000"], [98000001.5], [-9800000101], [NaN],
  ])("rejects %j", (input) => {
    expect(normalisePhone(input)).toBeNull();
  });

  it("gives an actionable reason", () => {
    const r = parsePhone("98000001");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("Mobile number has 8 digits; it needs exactly 10");
  });
});
