// Exercises the server action's own logic (re-validation, dedupe, assignment, counting, error mapping)
// against a stand-in for Supabase. The SQL side is covered separately in tests/db.
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "00000000-0000-0000-0000-0000000000b1";
const BATCH = "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11";
const CALLERS = [
  { id: "c1", full_name: "Asha Verma", login_id: "caller01" },
  { id: "c2", full_name: "Ravi Kumar", login_id: "caller02" },
];

const state = {
  existing: new Set<string>(),
  inserted: [] as Record<string, unknown>[],
  batchOpen: true,
  upsertError: null as null | { message: string },
};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = self; b.eq = self; b.is = self;
  b.maybeSingle = async () => ({ data: table === "upload_batches" && state.batchOpen ? { id: BATCH } : null });
  b.then = (resolve: (v: unknown) => void) => resolve({ data: table === "profiles" ? CALLERS : [], error: null });
  b.upsert = (rows: Record<string, unknown>[]) => {
    const fresh = state.upsertError ? [] : rows.filter((r) => !state.existing.has(r.reg_no as string));
    if (!state.upsertError) fresh.forEach((r) => { state.existing.add(r.reg_no as string); state.inserted.push(r); });
    return { select: async () => ({ data: fresh.map((r) => ({ reg_no: r.reg_no })), error: state.upsertError }) };
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: builder, rpc: async () => ({ data: [], error: null }) }) }));
vi.mock("@/lib/auth", () => ({ requireProfile: async () => ({ id: ME, role: "manager" }) }));

const { importChunk } = await import("@/app/(app)/leads/upload/actions");

const row = (n: number, raw: Record<string, string | number | null>) => ({ rowNumber: n, raw });

beforeEach(() => {
  state.existing = new Set(); state.inserted = []; state.batchOpen = true; state.upsertError = null;
});

describe("importChunk", () => {
  it("imports good rows, resolves callers, and counts everything", async () => {
    state.existing.add("MH12AB0002"); // already in the system
    const res = await importChunk({
      batchId: BATCH,
      rows: [
        row(2, { reg_no: "MH12AB0001", name: "A", phone: "9800000101", assigned_to: "Asha Verma" }),
        row(3, { reg_no: "MH12AB0002", name: "B", phone: "9800000102" }), // exists in DB -> duplicate
        row(4, { reg_no: "MH12AB0003", name: "C", phone: "12345" }), // bad phone -> invalid
        row(5, { reg_no: "MH12AB0001", name: "D", phone: "9800000104" }), // repeat in chunk -> duplicate
        row(6, { reg_no: "MH12AB0005", name: "E", phone: "9800000105", assigned_to: "Nobody Here" }), // unmatched
        row(7, { reg_no: "MH12AB0006", name: "F", phone: "+91 98000 00106", assigned_to: "caller02" }),
      ],
    });
    expect(res).toEqual({ ok: true, added: 3, duplicates: 2, invalid: 1, unassigned: 1 });
    const byReg = Object.fromEntries(state.inserted.map((r) => [r.reg_no, r]));
    expect(byReg.MH12AB0001).toMatchObject({ assigned_to: "c1", batch_id: BATCH, phone: "9800000101" });
    expect(byReg.MH12AB0005).toMatchObject({ assigned_to: null });
    expect(byReg.MH12AB0006).toMatchObject({ assigned_to: "c2", phone: "9800000106" });
    expect(byReg.MH12AB0001).not.toHaveProperty("assignee_text");
  });

  it("does not trust the browser: invalid rows sent anyway are rejected", async () => {
    const res = await importChunk({ batchId: BATCH, rows: [row(2, { reg_no: "", name: "", phone: "bad" })] });
    expect(res).toEqual({ ok: true, added: 0, duplicates: 0, invalid: 1, unassigned: 0 });
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses a closed or foreign batch, and malformed input", async () => {
    state.batchOpen = false;
    const closed = await importChunk({ batchId: BATCH, rows: [row(2, { reg_no: "MH12AB0001", name: "A", phone: "9800000101" })] });
    expect(closed).toMatchObject({ ok: false, message: expect.stringMatching(/already closed/) });
    expect(await importChunk({ batchId: "nope", rows: [] })).toMatchObject({ ok: false });
    expect(await importChunk({ batchId: BATCH, rows: Array.from({ length: 501 }, (_, i) => row(i + 2, {})) })).toMatchObject({ ok: false });
  });

  it("shows a plain message, never raw database text, when the insert fails", async () => {
    state.upsertError = { message: 'duplicate key value violates unique constraint "leads_pkey" (SQLSTATE 23505)' };
    const res = await importChunk({ batchId: BATCH, rows: [row(2, { reg_no: "MH12AB0001", name: "A", phone: "9800000101" })] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).not.toMatch(/SQLSTATE|constraint|leads_pkey/);
      expect(res.message).toMatch(/try again/i);
    }
  });
});
