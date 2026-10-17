// "Message sent": stays in the caller's queue, allows a callback, and is not a "connected" call.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ASHA = "00000000-0000-0000-0000-0000000000c1";
const MGR = "00000000-0000-0000-0000-0000000000b1";
let db: PGlite;
const q = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);
async function asUser<T>(uid: string, fn: () => Promise<T>) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
const id = async (reg: string) => (await q("select id from public.leads where reg_no = $1", [reg])).rows[0].id as string;
const log = (reg: string, outcome: string, cb: string | null = null) =>
  id(reg).then((lid) => asUser(ASHA, () => q("select * from public.log_call($1::uuid, $2::public.lead_status, null, $3)", [lid, outcome, cb])));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  const dir = path.join(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  for (const [uid, login, role] of [[ASHA, "asha", "caller"], [MGR, "mgr", "manager"]]) {
    await q("insert into auth.users (id) values ($1)", [uid]);
    await q("insert into public.profiles (id, login_id, full_name, role) values ($1,$2,$3,$4)", [uid, login, login, role]);
  }
  for (const [reg, phone] of [["MH01M0001", "9866666661"], ["MH01M0002", "9866666662"], ["MH01M0003", "9866666663"], ["MH01M0004", "9866666663"]])
    await q("insert into public.leads (reg_no, name, phone, assigned_to) values ($1,$1,$2,$3)", [reg, phone, ASHA]);
});

describe("message sent", () => {
  it("is recorded, keeps the lead in the queue and counts as an attempt", async () => {
    await log("MH01M0001", "message_sent");
    const l = (await q("select status::text s, attempts from public.leads where reg_no = 'MH01M0001'")).rows[0];
    expect(l).toEqual({ s: "message_sent", attempts: 1 });
    const names = await asUser(ASHA, async () => (await q("select reg_no from public.my_queue('todo')")).rows.map((r) => r.reg_no));
    expect(names).toContain("MH01M0001");
  });
  it("waits in the same group as No answer, and can carry a callback time", async () => {
    const rows = await asUser(ASHA, async () => (await q("select reg_no, bucket from public.my_queue('todo')")).rows);
    expect(rows.find((r) => r.reg_no === "MH01M0001")?.bucket).toBe(3);
    await log("MH01M0002", "message_sent", new Date(Date.now() + 3600_000).toISOString());
    expect((await q("select callback_at is not null as has from public.leads where reg_no = 'MH01M0002'")).rows[0].has).toBe(true);
  });
  it("is not a connected call on the dashboard", async () => {
    const d = (await asUser(MGR, async () => (await q("select public.dashboard_summary(now() - interval '1 day', now() + interval '1 day') s")).rows))[0].s as { callers: { calls: number; connected: number }[] };
    const me = d.callers.find((c) => c.calls > 0)!;
    expect(me.calls).toBe(2);
    expect(me.connected).toBe(0);
  });
  it("a wrong number also closes a message-sent lead on the same number", async () => {
    await log("MH01M0003", "message_sent");
    await log("MH01M0004", "wrong_number");
    expect((await q("select status::text s from public.leads where reg_no = 'MH01M0003'")).rows[0].s).toBe("wrong_number");
  });
});
