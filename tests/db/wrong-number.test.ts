// "Wrong number": removes the lead for callers, is reversible by managers, never sets do-not-call.
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
const row = async (reg: string) => (await q("select status, dnd, attempts, callback_at from public.leads where reg_no = $1", [reg])).rows[0];
const queue = (who: string, filter = "todo") => asUser(who, async () => (await q("select name from public.my_queue($1)", [filter])).rows.map((r) => r.name));

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
  const mk = (reg: string, name: string, phone: string, owner: string, status = "new") =>
    q("insert into public.leads (reg_no, name, phone, assigned_to, status) values ($1,$2,$3,$4,$5::public.lead_status)", [reg, name, phone, owner, status]);
  await mk("MH01W0001", "target", "9811111111", ASHA);
  await mk("MH01W0002", "same-number-new", "9811111111", ASHA);                 // same phone, untouched: also wrong
  await mk("MH01W0003", "same-number-callback", "9811111111", ASHA, "callback");
  await mk("MH01W0004", "same-number-sold", "9811111111", ASHA, "sold");        // finished business: left alone
  await mk("MH01W0005", "other-number", "9822222222", ASHA);                    // different number: untouched
  await mk("MH01W0006", "ravi-lead-same-number", "9811111111", RAVI);           // another caller's, same number
  await mk("MH01W0007", "second-wrong", "9833333333", ASHA);
});

describe("wrong number", () => {
  it("the outcome exists, is recorded, and clears any callback", async () => {
    const lead = await asUser(ASHA, async () => (await q("select * from public.log_call($1, 'wrong_number', 'number belongs to a shop')", [await id("MH01W0001")])).rows[0]);
    expect(lead).toMatchObject({ status: "wrong_number", attempts: 1, dnd: false, callback_at: null });
    const log = (await q("select outcome, note from public.call_logs where lead_id = $1", [await id("MH01W0001")])).rows;
    expect(log).toEqual([{ outcome: "wrong_number", note: "number belongs to a shop" }]);
  });

  it("is NOT a do-not-call: the dnd flag stays off", async () => {
    expect((await row("MH01W0001")).dnd).toBe(false);
  });

  it("closes the other unfinished leads on the same number, and only those", async () => {
    expect((await row("MH01W0002")).status).toBe("wrong_number");
    expect((await row("MH01W0003")).status).toBe("wrong_number");
    expect((await row("MH01W0003")).callback_at).toBeNull();
    expect((await row("MH01W0004")).status).toBe("sold");        // finished: untouched
    expect((await row("MH01W0005")).status).toBe("new");         // different number: untouched
    expect((await row("MH01W0006")).status).toBe("wrong_number"); // same number, other caller: closed too
    expect((await row("MH01W0002")).attempts).toBe(0);           // no fake call history on the others
  });

  it("disappears from the caller's lists entirely", async () => {
    const all = [...(await queue(ASHA, "todo")), ...(await queue(ASHA, "closed")), ...(await queue(ASHA, "new")), ...(await queue(ASHA, "interested"))];
    for (const gone of ["target", "same-number-new", "same-number-callback"]) expect(all).not.toContain(gone);
    expect(all).toContain("other-number");
    expect(await queue(RAVI, "todo")).not.toContain("ravi-lead-same-number");
    const counts = await asUser(ASHA, async () => (await q("select * from public.my_queue_counts()")).rows[0]);
    expect(Number(counts.todo)).toBe(2); // other-number, second-wrong
  });

  it("can't be called again, even directly", async () => {
    const target = await id("MH01W0001"); // looked up as the system: the caller can't even see it (RLS)
    await asUser(ASHA, async () => { // the owner calling the function directly is refused too
      await expect(q("select public.log_call($1, 'interested')", [target])).rejects.toThrow(/lead_wrong_number/);
    });
    // and for someone who can still reach it (a manager), the database refuses a new call on it
    await asUser(MGR, async () => {
      await expect(q("select public.log_call($1, 'interested')", [target])).rejects.toThrow(/lead_wrong_number/);
    });
  });

  it("managers still see it, labelled, and filter on it", async () => {
    const rows = await asUser(MGR, async () => (await q("select reg_no, status from public.staff_leads('any','wrong_number',null,null,50,0)")).rows);
    expect(rows.map((r) => r.reg_no).sort()).toEqual(["MH01W0001", "MH01W0002", "MH01W0003", "MH01W0006"]);
    const s = await asUser(MGR, async () => (await q("select public.dashboard_summary(null, null) as s")).rows[0].s as { by_status: Record<string, number> });
    expect(s.by_status.wrong_number).toBe(4);
  });

  it("is audited", async () => {
    const a = await q("select actor_id, details from public.audit_log where action = 'wrong_number'");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actor_id).toBe(ASHA);
  });
});

describe("reopen", () => {
  it("a caller cannot reopen", async () => {
    const target = await id("MH01W0001");
    await asUser(ASHA, async () => {
      await expect(q("select public.reopen_leads($1)", [[target]])).rejects.toThrow(/not_allowed/);
    });
  });

  it("a manager reopens wrong-number leads only; other statuses are left alone", async () => {
    const ids = [await id("MH01W0001"), await id("MH01W0004"), await id("MH01W0005")]; // wrong, sold, new
    const n = await asUser(MGR, async () => Number((await q("select public.reopen_leads($1) as n", [ids])).rows[0].n));
    expect(n).toBe(1);
    expect((await row("MH01W0001")).status).toBe("new");
    expect((await row("MH01W0004")).status).toBe("sold");
    expect(await queue(ASHA, "new")).toContain("target"); // back in the caller's queue
  });

  it("is audited", async () => {
    const a = await q("select actor_id, details from public.audit_log where action = 'reopen_leads'");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actor_id).toBe(MGR);
  });
});

describe("do-not-call is unaffected", () => {
  it("still sets the flag, is still permanent, and still hides the lead", async () => {
    await asUser(ASHA, async () => { await q("select public.log_call($1, 'do_not_call')", [await id("MH01W0007")]); });
    expect(await row("MH01W0007")).toMatchObject({ status: "do_not_call", dnd: true });
    expect(await queue(ASHA, "todo")).not.toContain("second-wrong");
    await asUser(MGR, async () => {
      await expect(q("update public.leads set dnd = false, status = 'new' where reg_no = 'MH01W0007'")).rejects.toThrow(/dnd_locked/);
    });
    // and reopen does not touch it
    const n = await asUser(MGR, async () => Number((await q("select public.reopen_leads($1) as n", [[await id("MH01W0007")]])).rows[0].n));
    expect(n).toBe(0);
  });
});
