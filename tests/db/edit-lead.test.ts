// Renewal date + callers editing their own leads.
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
const id = async (reg: string) => (await q("select id from public.leads where reg_no = $1", [reg])).rows[0].id as string;
const edit = (who: string | null, leadId: string, patch: Record<string, unknown>) =>
  asUser(who, async () => (await q("select * from public.update_lead($1::uuid, $2::jsonb)", [leadId, JSON.stringify(patch)])).rows[0]);
const get = async (reg: string) => (await q("select *, renewal_date::text as rd from public.leads where reg_no = $1", [reg])).rows[0];

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
  for (const [uid, login, role] of [[ASHA, "asha", "caller"], [RAVI, "ravi", "caller"], [MGR, "mgr", "manager"]]) {
    await q("insert into auth.users (id) values ($1)", [uid]);
    await q("insert into public.profiles (id, login_id, full_name, role) values ($1,$2,$3,$4)", [uid, login, login, role]);
  }
  const mk = (reg: string, name: string, phone: string, owner: string, status = "new", extra = "") =>
    q(`insert into public.leads (reg_no, name, phone, assigned_to, status ${extra ? ", reg_date" : ""}) values ($1,$2,$3,$4,$5::public.lead_status ${extra ? ",$6" : ""})`,
      extra ? [reg, name, phone, owner, status, extra] : [reg, name, phone, owner, status]);
  await mk("MH01E0001", "editable", "9844444441", ASHA, "new", "2026-03-01");
  await mk("MH01E0002", "other", "9844444442", ASHA);
  await mk("MH01E0003", "ravi-own", "9844444443", RAVI);
  await mk("MH01E0004", "dnd-lead", "9844444444", ASHA);
  await q("update public.leads set status = 'do_not_call', dnd = true where reg_no = 'MH01E0004'");
  await mk("MH01E0005", "dnd-target", "9844444445", RAVI);
  await q("update public.leads set status = 'do_not_call', dnd = true where reg_no = 'MH01E0005'");
});

describe("renewal date", () => {
  it("defaults to registration date + 5 days", async () => {
    expect((await get("MH01E0001")).rd).toBe("2026-03-06");
  });
  it("an explicit renewal date is kept; no reg date means no renewal date", async () => {
    await q("insert into public.leads (reg_no, name, phone, reg_date, renewal_date) values ('MH01E0010','x','9844444450','2026-03-01','2026-09-20')");
    expect((await get("MH01E0010")).rd).toBe("2026-09-20");
    await q("insert into public.leads (reg_no, name, phone) values ('MH01E0011','x','9844444451')");
    expect((await get("MH01E0011")).rd).toBeNull();
  });
  it("editing the registration date moves the renewal date only if it was not set by hand", async () => {
    await edit(ASHA, await id("MH01E0001"), { reg_date: "2026-04-10" });
    expect((await get("MH01E0001")).rd).toBe("2026-04-15");
    await edit(ASHA, await id("MH01E0001"), { renewal_date: "2026-10-01" });
    expect((await get("MH01E0001")).rd).toBe("2026-10-01");
    await edit(ASHA, await id("MH01E0001"), { reg_date: "2026-04-20", renewal_date: "2026-10-01" });
    expect((await get("MH01E0001")).rd).toBe("2026-10-01");
  });
  it("shows in the caller queue and the manager list", async () => {
    const mine = await asUser(ASHA, async () => (await q("select reg_no, renewal_date::text rd from public.my_queue('todo') where reg_no = 'MH01E0001'")).rows);
    expect(mine[0].rd).toBe("2026-10-01");
    const staff = await asUser(MGR, async () => (await q("select reg_no, renewal_date::text rd from public.staff_leads('any','any',null,null,50,0) where reg_no = 'MH01E0001'")).rows);
    expect(staff[0].rd).toBe("2026-10-01");
  });
});

describe("update_lead", () => {
  it("lets a caller change any detail on their own lead and normalises it", async () => {
    const r = await edit(ASHA, await id("MH01E0002"), {
      name: "  New   Name ", phone: "+91 98765 43299", reg_no: "mh-02 ab 9999", city: "Pune", state: "MAHARASHTRA",
      vehicle_make: "honda", sale_amount: "85000", seat_capacity: "2", guardian_name: "Parent", address: "1 Street",
    });
    expect(r).toMatchObject({ name: "New Name", phone: "9876543299", reg_no: "MH02AB9999", city: "Pune", seat_capacity: 2 });
  });
  it("blanks an optional field but not the name", async () => {
    await edit(ASHA, await id("MH02AB9999"), { city: "" });
    expect((await get("MH02AB9999")).city).toBeNull();
    await expect(edit(ASHA, await id("MH02AB9999"), { name: "  " })).rejects.toThrow(/name_required/);
  });
  it.each([
    [{ phone: "12345" }, /invalid_phone/],
    [{ reg_no: "MH01E0003" }, /duplicate_vehicle/],
    [{ reg_date: "1900-01-01" }, /invalid_date/],
    [{ renewal_date: "not-a-date" }, /invalid_date/],
    [{ sale_amount: "abc" }, /invalid_number/],
    [{ seat_capacity: "x" }, /invalid_number/],
  ])("rejects %j", async (patch, err) => {
    await expect(edit(ASHA, await id("MH02AB9999"), patch)).rejects.toThrow(err);
  });
  it("cannot touch another caller's lead, or be called signed-out", async () => {
    await expect(edit(ASHA, await id("MH01E0003"), { city: "X" })).rejects.toThrow();
    await expect(edit(null, await id("MH01E0003"), { city: "X" })).rejects.toThrow();
  });
  it("cannot edit a do-not-call lead or move a number onto a do-not-call number", async () => {
    await expect(edit(ASHA, await id("MH01E0004"), { city: "X" })).rejects.toThrow();
    await expect(edit(ASHA, await id("MH02AB9999"), { phone: "9844444445" })).rejects.toThrow(/lead_blocked/);
  });
  it("managers can edit any lead", async () => {
    const r = await edit(MGR, await id("MH01E0003"), { city: "Delhi" });
    expect(r).toMatchObject({ city: "Delhi" });
  });
  it("audits what changed, and does nothing for a no-op", async () => {
    const lid = await id("MH01E0003");
    await edit(MGR, lid, { city: "Mumbai" });
    const a = (await q("select details from public.audit_log where action = 'edit_lead' order by created_at desc limit 1")).rows[0].details as { changes: Record<string, { from: unknown; to: unknown }> };
    expect(a.changes.city).toEqual({ from: "Delhi", to: "Mumbai" });
    const before = (await q("select count(*)::int n from public.audit_log where action = 'edit_lead'")).rows[0].n;
    await edit(MGR, lid, { city: "Mumbai" });
    expect((await q("select count(*)::int n from public.audit_log where action = 'edit_lead'")).rows[0].n).toBe(before);
  });
});
