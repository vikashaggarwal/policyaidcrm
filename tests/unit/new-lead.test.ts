import { describe, expect, it } from "vitest";
import { validateNewLead } from "@/lib/new-lead";

describe("validateNewLead", () => {
  it("name and mobile alone are enough", () => {
    const r = validateNewLead({ name: "Meera Joshi", phone: "98765 43210" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload).toMatchObject({ name: "Meera Joshi", phone: "9876543210", reg_no: null, reg_date: null, city: null, sale_amount: null });
    }
  });

  it("blank optional fields never cause errors", () => {
    const blanks = Object.fromEntries(
      ["guardian_name", "reg_no", "reg_date", "vehicle_make", "vehicle_model", "vehicle_class", "fuel", "city", "state", "rto_code", "address", "engine_no", "chassis_no", "sale_amount", "seat_capacity"].map((k) => [k, "  "]),
    );
    expect(validateNewLead({ name: "A", phone: "9876543210", ...blanks }).ok).toBe(true);
  });

  it("asks for each compulsory field by name", () => {
    const r = validateNewLead({ name: " ", phone: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual({ name: "Enter the person's name.", phone: "Enter the mobile number." });
  });

  it("explains a bad number", () => {
    const r = validateNewLead({ name: "A", phone: "12345" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.phone).toBe("Mobile number has 5 digits; it needs exactly 10.");
  });

  it("normalises +91 numbers and optional fields", () => {
    const r = validateNewLead({
      name: "A", phone: "+91 98765-43210", reg_no: "mh-12 ab 1234", reg_date: "15/01/2026",
      sale_amount: "₹1,25,000", seat_capacity: "5", city: " Pune ",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.payload).toMatchObject({ phone: "9876543210", reg_no: "MH12AB1234", reg_date: "2026-01-15", sale_amount: 125000, seat_capacity: 5, city: "Pune" });
  });

  it("flags optional fields only when they are filled in wrongly", () => {
    const r = validateNewLead({ name: "A", phone: "9876543210", reg_no: "!", reg_date: "soon", sale_amount: "lots", seat_capacity: "2.5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["reg_date", "reg_no", "sale_amount", "seat_capacity"]);
  });
});
