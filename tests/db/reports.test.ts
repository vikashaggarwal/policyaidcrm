// Dashboard numbers, the manager's leads list, export auditing. Real Postgres, real migrations.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import type { CallerStats, DashboardSummary } from "@/lib/dashboard";

const MGR = "00000000-0000-0000-0000-0000000000b1";
const ASHA = "00000000-0000-0000-0000-0000000000c1";
const RAVI = "00000000-0000-0000-0000-0000000000c2";
const GONE = "00000000-0000-0000-0000-0000000000c3"; // inactive, but did work in the period

let db: PGlite;
const q = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);
async function asUser<T>(uid: string | null, fn: () => Promise<T>) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
let phoneSeq = 10000; // deterministic phones: 9800010001, 9800010002, ...
const day = (d: number) => new Date(Date.UTC(2026, 9, 10 + d, 6, 0, 0)).toISOString(); // 10 Oct 2026 + d, 11:30 IST
const id = async (reg: string) => (await q("select id from public.leads where reg_no = $1", [reg])).rows[0].id as string;

const summary = (from: string | null, to: string | null) =>
  asUser(MGR, async () => (await q("select public.dashboard_summary($1, $2) as s", [from, to])).rows[0].s as DashboardSummary);

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

  for (const [uid, login, name, role, active] of [
    [MGR, "mgr", "Manager", "manager", true], [ASHA, "asha", "Asha", "caller", true],
    [RAVI, "ravi", "Ravi", "caller", true], [GONE, "gone", "Former Caller", "caller", false],
  ] as const) {
    await q("insert into auth.users (id) values ($1)", [uid]);
    await q("insert into public.profiles (id, login_id, full_name, role, active) values ($1,$2,$3,$4,$5)", [uid, login, name, role, active]);
  }

  // 10 leads loaded on day 0; 2 more on day 5 (outside a "day 0" window)
  const mk = (reg: string, owner: string | null, status: string, attempts: number, created: string, cb: string | null = null, dnd = false) =>
    q(`insert into public.leads (reg_no, name, phone, assigned_to, status, attempts, created_at, callback_at, dnd)
       values ($1,$1,$2,$3,$4::public.lead_status,$5,$6,$7,$8)`,
      [reg, "98000" + String(++phoneSeq).padStart(5, "0"), owner, status, attempts, created, cb, dnd]);
  await mk("MH01R0001", ASHA, "sold", 2, day(0));
  await mk("MH01R0002", ASHA, "interested", 1, day(0));
  await mk("MH01R0003", ASHA, "no_answer", 3, day(0));
  await mk("MH01R0004", ASHA, "new", 0, day(0));
  await mk("MH01R0005", ASHA, "callback", 1, day(0), new Date(Date.now() - 3600_000).toISOString()); // overdue
  await mk("MH01R0006", RAVI, "not_interested", 1, day(0));
  await mk("MH01R0007", RAVI, "new", 0, day(0));
  await mk("MH01R0008", RAVI, "new", 0, day(0));
  await mk("MH01R0009", null, "new", 0, day(0));
  await mk("MH01R0010", RAVI, "do_not_call", 1, day(0), null, true);
  await mk("MH01R0011", RAVI, "new", 0, day(5));
  await mk("MH01R0012", null, "new", 0, day(5));

  const log = async (reg: string, caller: string, outcome: string, when: string) =>
    q("insert into public.call_logs (lead_id, caller_id, outcome, created_at) values ($1,$2,$3::public.lead_status,$4)",
      [await id(reg), caller, outcome, when]);
  // Asha, day 0 and 1
  await log("MH01R0001", ASHA, "no_answer", day(0));
  await log("MH01R0001", ASHA, "sold", day(1));          // same lead twice: counts once as "called"
  await log("MH01R0002", ASHA, "interested", day(0));
  await log("MH01R0003", ASHA, "no_answer", day(0));
  await log("MH01R0005", ASHA, "callback", day(1));
  // Ravi
  await log("MH01R0006", RAVI, "not_interested", day(0));
  await log("MH01R0010", RAVI, "do_not_call", day(0));
  // A former caller, now switched off, still shows because they worked in the period
  await log("MH01R0003", GONE, "interested", day(0));
});

describe("dashboard_summary", () => {
  it("pipeline: leads loaded in the period, by status", async () => {
    const s = await summary(day(0), day(1)); // day 0 only
    expect(s.loaded).toBe(10);
    expect(s.called_once).toBe(6);
    expect(s.sold).toBe(1);
    expect(s.by_status).toEqual({ sold: 1, interested: 1, no_answer: 1, new: 4, callback: 1, not_interested: 1, do_not_call: 1 });
  });

  it("all time includes later loads; null bounds mean no limit", async () => {
    const s = await summary(null, null);
    expect(s.loaded).toBe(12);
  });

  it("an empty period is zeros, not an error", async () => {
    const s = await summary(day(30), day(31));
    expect(s).toMatchObject({ loaded: 0, called_once: 0, sold: 0, by_status: {}, calls: 0 });
  });

  it("caller table: calls made in the period, distinct leads, connected excludes no-answer", async () => {
    const s = await summary(day(0), day(2));
    const asha = s.callers.find((c: CallerStats) => c.id === ASHA);
    expect(asha).toMatchObject({
      calls: 5, called: 4,        // 5 calls on 4 different leads
      connected: 3,               // sold, interested, callback (the no-answers don't count)
      interested: 1, sold: 1,
      assigned: 5, overdue: 1, unworked: 1,
    });
    const ravi = s.callers.find((c: CallerStats) => c.id === RAVI);
    expect(ravi).toMatchObject({ calls: 2, called: 2, connected: 2, interested: 0, sold: 0, assigned: 5 });
  });

  it("the date range moves caller activity", async () => {
    const s = await summary(day(1), day(2)); // day 1 only: sold + callback by Asha
    const asha = s.callers.find((c: CallerStats) => c.id === ASHA);
    expect(asha).toMatchObject({ calls: 2, called: 2, sold: 1, interested: 0 });
    expect(s.callers.find((c: CallerStats) => c.id === RAVI)).toMatchObject({ calls: 0, called: 0 });
  });

  it("keeps an inactive caller visible if they worked in the period, and hides one who didn't", async () => {
    const withWork = await summary(day(0), day(1));
    expect(withWork.callers.map((c: CallerStats) => c.name)).toContain("Former Caller");
    const without = await summary(day(30), day(31));
    expect(without.callers.map((c: CallerStats) => c.name)).not.toContain("Former Caller");
  });

  it("live numbers ignore the date range", async () => {
    const a = await summary(day(0), day(1));
    const b = await summary(day(30), day(31));
    expect(a.callbacks_due).toBe(1);
    expect(b.callbacks_due).toBe(1);
    expect(a.unassigned_new).toBe(2);
  });

  it("is manager-only", async () => {
    await asUser(ASHA, async () => {
      await expect(q("select public.dashboard_summary(null, null)")).rejects.toThrow(/not_allowed/);
    });
  });
});

describe("staff_leads", () => {
  const list = (a = "any", s = "any", search: string | null = null, limit = 50, offset = 0) =>
    asUser(MGR, async () => (await q("select * from public.staff_leads($1,$2,$3,null,$4,$5)", [a, s, search, limit, offset])).rows);

  it("filters by caller, unassigned and status", async () => {
    expect((await list(ASHA)).length).toBe(5);
    expect((await list("unassigned")).map((r) => r.reg_no).sort()).toEqual(["MH01R0009", "MH01R0012"]);
    expect((await list("any", "sold")).map((r) => r.reg_no)).toEqual(["MH01R0001"]);
    expect((await list(ASHA, "new")).map((r) => r.reg_no)).toEqual(["MH01R0004"]);
  });

  it("pages with a total, newest first, and returns the caller's name", async () => {
    const p1 = await list("any", "any", null, 5, 0);
    const p2 = await list("any", "any", null, 5, 5);
    const p3 = await list("any", "any", null, 5, 10);
    expect(p1).toHaveLength(5); expect(p2).toHaveLength(5); expect(p3).toHaveLength(2);
    expect(Number(p1[0].total_count)).toBe(12);
    expect(new Set([...p1, ...p2, ...p3].map((r) => r.id)).size).toBe(12);
    expect(String(p1[0].created_at) >= String(p3[1].created_at)).toBe(true);
    expect((await list(ASHA))[0].assigned_name).toBe("Asha");
  });

  it("searches, and ignores junk filters safely", async () => {
    expect((await list("any", "any", "R0007")).map((r) => r.reg_no)).toEqual(["MH01R0007"]);
    // digits inside a registration number must not be read as a phone search
    expect((await list("any", "any", "R0001")).map((r) => r.reg_no)).toEqual(["MH01R0001"]);
    expect((await list("any", "any", "9800010003")).map((r) => r.reg_no)).toHaveLength(1); // a whole number is a phone search
    expect(await list("not-a-uuid")).toEqual([]);
    expect(await list("any", "bogus")).toEqual([]);
  });

  it("select-all ids match the filter and are manager-only", async () => {
    const ids = await asUser(MGR, async () => (await q("select * from public.staff_lead_ids($1,'any',null,null)", [RAVI])).rows);
    expect(ids).toHaveLength(5);
    await asUser(ASHA, async () => {
      await expect(q("select * from public.staff_leads()")).rejects.toThrow(/not_allowed/);
      await expect(q("select * from public.staff_lead_ids()")).rejects.toThrow(/not_allowed/);
      await expect(q("select public.unworked_count($1)", [ASHA])).rejects.toThrow(/not_allowed/);
    });
  });

  it("unworked_count matches what reassign_unworked moves", async () => {
    const n = await asUser(MGR, async () => Number((await q("select public.unworked_count($1) as n", [RAVI])).rows[0].n));
    expect(n).toBe(3); // 0007, 0008, 0011; the do-not-call one is excluded
    const moved = await asUser(MGR, async () => Number((await q("select public.reassign_unworked($1,$2) as n", [RAVI, ASHA])).rows[0].n));
    expect(moved).toBe(n);
  });
});

describe("log_export", () => {
  it("records who exported what, and only for managers", async () => {
    await asUser(MGR, async () => { await q("select public.log_export('leads','csv',123,'{\"status\":\"new\"}')"); });
    const a = await q("select actor_id, details from public.audit_log where action = 'export'");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actor_id).toBe(MGR);
    expect(a.rows[0].details).toMatchObject({ format: "csv", rows: 123 });
    await asUser(ASHA, async () => {
      await expect(q("select public.log_export('leads','csv',1,'{}')")).rejects.toThrow(/not_allowed/);
    });
    await asUser(MGR, async () => {
      await expect(q("select public.log_export('passwords','csv',1,'{}')")).rejects.toThrow(/invalid_export/);
    });
  });
});
