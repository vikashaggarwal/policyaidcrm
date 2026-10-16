import { describe, expect, it } from "vitest";
import { validateNewLead } from "@/lib/new-lead";
import { matchHeader } from "@/lib/upload/headers";
import { validateRow } from "@/lib/upload/validate";

describe("renewal date", () => {
  it("is optional, normalised, and refused when not a date", () => {
    const ok = validateNewLead({ name: "A", phone: "9876543210", renewal_date: "20/09/2026" });
    expect(ok.ok && ok.payload.renewal_date).toBe("2026-09-20");
    const blank = validateNewLead({ name: "A", phone: "9876543210" });
    expect(blank.ok && blank.payload.renewal_date).toBeNull();
    const bad = validateNewLead({ name: "A", phone: "9876543210", renewal_date: "soon" });
    expect(!bad.ok && bad.errors.renewal_date).toBeTruthy();
  });
  it.each(["RENEWAL DATE", "Policy Expiry", "Expiry Date", "Due Date"])("upload header %s maps to renewal_date", (h) => {
    expect(matchHeader(h)).toBe("renewal_date");
  });
  it("upload rows read it, and flag one that isn't a date", () => {
    const base = { phone: "9876543210", name: "A", reg_no: "MH12AB1234" };
    const good = validateRow({ ...base, renewal_date: "20/09/2026" });
    expect(good.ok && good.lead.renewal_date).toBe("2026-09-20");
    expect(validateRow({ ...base, renewal_date: "later" }).ok).toBe(false);
    const none = validateRow(base);
    expect(none.ok && none.lead.renewal_date).toBeNull();
  });
});
