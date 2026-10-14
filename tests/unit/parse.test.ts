import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { analyseLocally, countRows } from "@/lib/upload/analyse";
import { mapRows, readFile, readPasted, UploadError } from "@/lib/upload/parse";

const HEADERS = ["STATE", "REG NO", "REG DATE", "OWNER NAM", "MOBILE", "CHASIS NO", "SALE AMOUN"];

function xlsxFile(aoa: unknown[][], name = "leads.xlsx") {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["ignored"], ["second sheet"]]), "Other");
  const bytes = XLSX.write(wb, { type: "array", bookType: name.endsWith(".xls") ? "biff8" : "xlsx" }) as ArrayBuffer;
  return new File([bytes], name);
}

describe("readFile", () => {
  it("reads an .xlsx: numeric phones, Excel dates, first sheet only", async () => {
    const file = xlsxFile([
      HEADERS,
      ["MAHARASHTRA", "MH12FAKE0001", 46037, "Demo One", 9800000101, "FAKECHS00001", 125000],
      ["DELHI", "DL01FAKE0002", "15/01/2026", "Demo Two", "+91 98000 00102", "FAKECHS00002", "1,50,000"],
      ["GUJARAT", "GJ01FAKE0003", 46037, "Demo Three", 9.8e9, "", ""], // Excel number 9800000000
    ]);
    const { mapping, rows } = mapRows(await readFile(file));
    expect(mapping.missingRequired).toEqual([]);
    expect(rows).toHaveLength(3);
    const out = analyseLocally(rows);
    expect(out.map((r) => r.status)).toEqual(["new", "new", "new"]);
    expect(out[0].lead).toMatchObject({ phone: "9800000101", reg_date: "2026-01-15", sale_amount: 125000 });
    expect(out[1].lead).toMatchObject({ phone: "9800000102", reg_date: "2026-01-15", sale_amount: 150000 });
    expect(rows[0].rowNumber).toBe(2);
  });

  it("reads an old .xls too", async () => {
    const { rows } = mapRows(await readFile(xlsxFile([HEADERS, ["X", "MH12FAKE0009", 46037, "A", 9800000109]], "old.xls")));
    expect(analyseLocally(rows)[0].status).toBe("new");
  });

  it("reads a CSV and keeps long IDs and phone formats as text", async () => {
    const csv = [
      "Reg No,Customer Name,Mobile No,Chassis No",
      "MH12FAKE0001,Demo One,09800000101,1234567890123456789",
      'MH12FAKE0002,"Demo, Two",+91-98000-00102,AB12',
      "MH12FAKE0003,Demo Three,9.8E+09,AB13",
      "MH12FAKE0004,,9800000104,AB14",
    ].join("\n");
    const { rows } = mapRows(await readFile(new File([csv], "x.csv")));
    expect(rows[0].raw.chassis_no).toBe("1234567890123456789"); // not rounded to 1.23E+18
    const out = analyseLocally(rows);
    expect(out.map((r) => r.status)).toEqual(["new", "new", "invalid", "invalid"]);
    expect(out[1].lead?.name).toBe("Demo, Two");
    expect(out[2].reasons[0]).toMatch(/scientific notation/);
    expect(out[3].reasons[0]).toMatch(/name is missing/i);
    expect(countRows(out)).toMatchObject({ new: 2, invalid: 2 });
  });

  it("skips blank rows and a title row above the headers", async () => {
    const file = xlsxFile([["Leads for October"], HEADERS, [], ["X", "MH12FAKE0001", 46037, "A", 9800000101]]);
    const { rows } = mapRows(await readFile(file));
    expect(rows).toHaveLength(1);
  });

  it("gives plain-language errors", async () => {
    await expect(readFile(new File(["x"], "notes.pdf"))).rejects.toThrow(UploadError);
    await expect(readFile(new File(["x"], "notes.pdf"))).rejects.toThrow(/Excel .* or CSV/);
    await expect(readFile(new File([new Uint8Array(11 * 1024 * 1024)], "big.csv"))).rejects.toThrow(/10 MB/);
    await expect(readFile(new File(["only one line"], "x.csv"))).rejects.toThrow(/header row/);
  });
});

describe("readPasted", () => {
  it("reads tab-separated rows pasted from Excel", async () => {
    const text = "REG NO\tOWNER NAME\tMOBILE\nMH12FAKE0001\tDemo One\t9800000101\nMH12FAKE0002\tDemo Two\t9800000102";
    const { rows } = mapRows(await readPasted(text));
    expect(analyseLocally(rows).map((r) => r.status)).toEqual(["new", "new"]);
  });

  it("reads comma-separated text and rejects empty input", async () => {
    const { rows } = mapRows(await readPasted("Reg No,Name,Mobile\nMH12FAKE0001,A,9800000101"));
    expect(rows).toHaveLength(1);
    await expect(readPasted("   ")).rejects.toThrow(/Paste your rows/);
  });
});
