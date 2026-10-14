import { describe, expect, it } from "vitest";
import { callbackPresets, describeCallback, formatIst, isoToIstLocal, istLocalToIso } from "@/lib/time";

describe("IST conversion", () => {
  it("treats picker values as Indian time", () => {
    expect(istLocalToIso("2026-10-15T14:30")).toBe("2026-10-15T09:00:00.000Z");
    expect(istLocalToIso("2026-10-15T00:15")).toBe("2026-10-14T18:45:00.000Z"); // crosses midnight UTC
  });
  it("round-trips", () => {
    for (const v of ["2026-01-01T00:00", "2026-12-31T23:59", "2026-10-15T14:30"]) {
      expect(isoToIstLocal(istLocalToIso(v)!)).toBe(v);
    }
  });
  it("rejects nonsense", () => {
    expect(istLocalToIso("")).toBeNull();
    expect(istLocalToIso("tomorrow")).toBeNull();
    expect(istLocalToIso("2026-02-31T10:00")).toBeNull();
  });
  it("formats in IST", () => {
    expect(formatIst("2026-10-15T09:00:00.000Z")).toMatch(/15 Oct,? 2:30 pm/);
  });
});

describe("describeCallback", () => {
  const now = new Date("2026-10-15T09:00:00Z");
  it.each([
    ["2026-10-15T09:00:00Z", "Due now", true],
    ["2026-10-15T08:35:00Z", "Overdue 25 min", true],
    ["2026-10-15T06:00:00Z", "Overdue 3 h", true],
    ["2026-10-13T09:00:00Z", "Overdue 2 d", true],
    ["2026-10-15T09:20:00Z", "In 20 min", false],
  ])("%s", (iso, text, due) => expect(describeCallback(iso, now)).toEqual({ text, due }));

  it("shows the clock time for later today and the date for later days", () => {
    expect(describeCallback("2026-10-15T14:00:00Z", now).text).toMatch(/^In 5 h · 15 Oct,? 7:30 pm$/);
    expect(describeCallback("2026-10-20T09:00:00Z", now).due).toBe(false);
  });
});

describe("callbackPresets", () => {
  it("offers future times only, on the IST clock", () => {
    // 10:00 IST on 15 Oct
    const p = callbackPresets(new Date("2026-10-15T04:30:00Z"));
    expect(p.map((x) => x.label)).toEqual(["In 1 hour", "Today 5 pm", "Tomorrow 10 am", "In 3 days, 10 am"]);
    expect(p[1].iso).toBe("2026-10-15T11:30:00.000Z"); // 17:00 IST
    expect(p[2].iso).toBe("2026-10-16T04:30:00.000Z"); // 10:00 IST
    expect(p[3].iso).toBe("2026-10-18T04:30:00.000Z");
  });
  it("drops 'Today 5 pm' once it is too close", () => {
    const p = callbackPresets(new Date("2026-10-15T10:30:00Z")); // 16:00 IST
    expect(p.map((x) => x.label)).not.toContain("Today 5 pm");
  });
  it("uses IST's date even when UTC is still the previous day", () => {
    const p = callbackPresets(new Date("2026-10-15T20:00:00Z")); // 01:30 IST on the 16th
    expect(p.find((x) => x.label === "Tomorrow 10 am")!.iso).toBe("2026-10-17T04:30:00.000Z");
  });
});
