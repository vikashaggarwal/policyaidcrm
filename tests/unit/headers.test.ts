import { describe, expect, it } from "vitest";
import { mapHeaders, matchHeader } from "@/lib/upload/headers";

const SHEET_HEADERS = [
  "STATE", "REG NO", "RTO CODE", "REG DATE", "OWNER NAME", "OWNER(S/W/D)", "ADDRESS", "ENGINE NO",
  "CHASIS NO", "VEHICLE MAKE", "VEHICLE MODEL VARIANT", "VEHICLE CLASS", "FUEL", "SALE AMOUNT",
  "SEAT CAPACITY", "MOBILE",
];

describe("matchHeader", () => {
  it("maps phone synonyms", () => {
    for (const h of ["Mobile", "Mobile No", "MOBILE NO.", "Mobile Number", "Contact", "Phone", "Contact No"]) {
      expect(matchHeader(h), h).toBe("phone");
    }
  });

  it("maps name, city, product, source and assigned to", () => {
    expect(matchHeader("Customer Name")).toBe("name");
    expect(matchHeader("Name")).toBe("name");
    expect(matchHeader("City")).toBe("city");
    expect(matchHeader("Product")).toBe("product");
    expect(matchHeader("Lead Source")).toBe("source");
    expect(matchHeader("Assigned To")).toBe("assigned_to");
    expect(matchHeader("Telecaller")).toBe("assigned_to");
  });

  it("ignores case, spacing and punctuation", () => {
    expect(matchHeader("  reg_no ")).toBe("reg_no");
    expect(matchHeader("Chassis No.")).toBe("chassis_no");
    expect(matchHeader("CHASIS NO")).toBe("chassis_no"); // the spelling in the real sheet
  });

  it("handles headers cut off by a narrow column", () => {
    expect(matchHeader("OWNER NAM")).toBe("name");
    expect(matchHeader("VEHICLE MAK")).toBe("vehicle_make");
    expect(matchHeader("VEHICLE MOD")).toBe("vehicle_model");
    expect(matchHeader("VEHICLE CLAS")).toBe("vehicle_class");
    expect(matchHeader("SALE AMOUN")).toBe("sale_amount");
    expect(matchHeader("SEAT CAPACIT")).toBe("seat_capacity");
  });

  it("returns null for unknown or ambiguous headers", () => {
    expect(matchHeader("Remarks")).toBeNull();
    expect(matchHeader("")).toBeNull();
    expect(matchHeader(undefined)).toBeNull();
    expect(matchHeader("veh")).toBeNull(); // too short to guess
  });
});

describe("mapHeaders", () => {
  it("maps all 16 columns of the real sheet", () => {
    const m = mapHeaders(SHEET_HEADERS);
    expect(Object.keys(m.columns)).toHaveLength(16);
    expect(m.missingRequired).toEqual([]);
    expect(m.ignored).toEqual([]);
    expect(m.columns.phone).toBe(15);
    expect(m.columns.name).toBe(4);
    expect(m.columns.guardian_name).toBe(5);
    expect(m.columns.reg_no).toBe(1);
  });

  it("reports missing required columns and ignored extras", () => {
    const m = mapHeaders(["Name", "Remarks", "Mobile"]);
    expect(m.missingRequired).toEqual(["reg_no"]);
    expect(m.ignored).toEqual(["Remarks"]);
  });

  it("uses the first column when two map to the same field", () => {
    const m = mapHeaders(["Mobile", "Contact No", "Name", "Reg No"]);
    expect(m.columns.phone).toBe(0);
    expect(m.ignored).toEqual(["Contact No"]);
  });
});
