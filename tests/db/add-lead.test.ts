// A caller adds a lead: name + mobile compulsory, everything else optional.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ASHA = "00000000-0000-0000-0000-0000000000c1";
const RAVI = "00000000-0000-0000-0000-0000000000c2";
const MGR = "00000000-0000-0000-0000-0000000000b1";

let db: PGlite;
const q = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);
async function asUser<T>(uid: string | null, fn: () => Promise<T>) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const add = (who: string | null, lead: Record<string, unknown>) =>
  asUser(who, async () => (await q("select * from public.add_lead($1::jsonb)", [JSON.stringify(lead)])).rows[0]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  const dir = path.join(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  for (const [id, login, role] of [[ASHA, "asha", "caller"], [RAVI, "ravi", "caller"], [MGR, "mgr", "manager"]]) {
    await q("insert into auth.users (id) values ($1)", [id]);
    await q("insert into public.profiles (id, login_id, full_name, role) values ($1,$2,$3,$4)", [id, login, login, role]);
  }
});

describe("add_lead", () => {
  it("name and mobile are enough; it is assigned to the caller and lands in their queue", async () => {
    const lead = await add(ASHA, { name: "  Meera   Joshi ", phone: "98765 43210" });
    expect(lead).toMatchObject({
      name: "Meera Joshi", phone: "9876543210", reg_no: null, assigned_to: ASHA,
      status: "new", attempts: 0, source: "Added by caller", product: "Motor renewal", batch_id: null,
    });
    const queue = await asUser(ASHA, async () => (await q("select name, reg_no from public.my_queue('new')")).rows);
    expect(queue.map((r) => r.name)).toContain("Meera Joshi");
    const search = await asUser(ASHA, async () => (await q("select name from public.my_queue('todo','meera')")).rows);
    expect(search).toHaveLength(1);
  });

  it("accepts every optional field, normalised", async () => {
    const lead = await add(ASHA, {
      name: "Full Details", phone: "+91 98765 43211", reg_no: "mh-12 ab 1234", reg_date: "2026-09-10",
      guardian_name: "Parent", state: "MAHARASHTRA", rto_code: "mh12", address: "1 Street", city: "Pune",
      engine_no: "eng1", chassis_no: "chs1", vehicle_make: "HONDA", vehicle_model: "ACTIVA",
      vehicle_class: "M-CYCLE", fuel: "PETROL", sale_amount: "85000", seat_capacity: "2",
    });
    expect(lead).toMatchObject({
      reg_no: "MH12AB1234", phone: "9876543211", rto_code: "MH12", engine_no: "ENG1", chassis_no: "CHS1",
      sale_amount: "85000.00", seat_capacity: 2, city: "Pune",
    });
    expect(String(lead.renewal_date)).toContain("2026"); // reg date + 5 days default
  });

  it("several leads without a registration number can coexist", async () => {
    await add(ASHA, { name: "No Reg One", phone: "9876543212" });
    await add(ASHA, { name: "No Reg Two", phone: "9876543213" });
    const n = (await q("select count(*)::int n from public.leads where reg_no is null")).rows[0].n as number;
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it.each([
    [{ name: "", phone: "9876543299" }, /name_required/],
    [{ name: "   ", phone: "9876543299" }, /name_required/],
    [{ phone: "9876543299" }, /name_required/],
    [{ name: "X" }, /invalid_phone/],
    [{ name: "X", phone: "12345" }, /invalid_phone/],
    [{ name: "X", phone: "5876543299" }, /invalid_phone/],
    [{ name: "X", phone: "9876543299", reg_no: "A!" }, /invalid_reg_no/],
    [{ name: "X", phone: "9876543299", reg_date: "not a date" }, /invalid_date/],
    [{ name: "X", phone: "9876543299", reg_date: "1950-01-01" }, /invalid_date/],
  ])("rejects bad input %j", async (lead, err) => {
    await expect(add(ASHA, lead)).rejects.toThrow(err);
  });

  it("refuses a number already in the system, with or without a vehicle", async () => {
    await expect(add(RAVI, { name: "Dup", phone: "9876543210" })).rejects.toThrow(/duplicate_phone/);
    await expect(add(RAVI, { name: "Dup", phone: "9000000001", reg_no: "MH12AB1234" })).rejects.toThrow(/duplicate_vehicle/);
  });

  it("allows a second vehicle for a known owner when a registration number is given", async () => {
    const lead = await add(ASHA, { name: "Meera Joshi", phone: "9876543210", reg_no: "MH14ZZ9999" });
    expect(lead.reg_no).toBe("MH14ZZ9999");
  });

  it("never adds a do-not-call number", async () => {
    await q("insert into public.leads (name, phone, reg_no, dnd, status) values ('Blocked','9111111111','MH01DN0001', true, 'do_not_call')");
    await expect(add(ASHA, { name: "Try", phone: "9111111111" })).rejects.toThrow(/lead_blocked/);
    await expect(add(ASHA, { name: "Try", phone: "9111111111", reg_no: "MH01NEW001" })).rejects.toThrow(/lead_blocked/);
  });

  it("is for callers only, and leaves an audit entry", async () => {
    await expect(add(MGR, { name: "Mgr", phone: "9222222222" })).rejects.toThrow(/not_allowed/);
    await expect(add(null, { name: "Anon", phone: "9222222223" })).rejects.toThrow();
    const a = await q("select actor_id from public.audit_log where action = 'add_lead'");
    expect(a.rows.length).toBeGreaterThan(0);
    expect(a.rows[0].actor_id).toBe(ASHA);
  });

  it("other callers cannot see it", async () => {
    const seen = await asUser(RAVI, async () => (await q("select name from public.my_queue('todo','Meera')")).rows);
    expect(seen).toHaveLength(0);
  });
});
