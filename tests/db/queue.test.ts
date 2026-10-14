// Queue ranking, filters, counts, search and visibility, run against real Postgres.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const CALLER = "00000000-0000-0000-0000-0000000000c1";
const OTHER = "00000000-0000-0000-0000-0000000000c2";
const MANAGER = "00000000-0000-0000-0000-0000000000b1";

let db: PGlite;
const q = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);

async function asUser<T>(uid: string | null, fn: () => Promise<T>, role = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}

const queue = (filter = "todo", search: string | null = null, limit = 100, offset = 0) =>
  asUser(CALLER, async () =>
    (await q("select * from public.my_queue($1,$2,$3,$4)", [filter, search, limit, offset])).rows);
const names = (rows: Record<string, unknown>[]) => rows.map((r) => r.name);

// minutes from now
const at = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function lead(reg: string, name: string, o: Partial<{
  phone: string; owner: string | null; status: string; callback: string | null; called: string | null;
  created: string; dnd: boolean; city: string;
}> = {}) {
  await q(
    `insert into public.leads (reg_no, name, phone, assigned_to, status, callback_at, last_called_at, created_at, dnd, city)
     values ($1,$2,$3,$4,$5::public.lead_status,$6,$7,$8,$9,$10)`,
    [reg, name, o.phone ?? "98000" + String(Math.floor(Math.random() * 99999)).padStart(5, "0"),
     o.owner === undefined ? CALLER : o.owner, o.status ?? "new", o.callback ?? null, o.called ?? null,
     o.created ?? at(-1000), o.dnd ?? false, o.city ?? null],
  );
}

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
  for (const [id, login, role] of [[CALLER, "caller01", "caller"], [OTHER, "caller02", "caller"], [MANAGER, "mgr", "manager"]]) {
    await q("insert into auth.users (id) values ($1)", [id]);
    await q("insert into public.profiles (id, login_id, full_name, role) values ($1,$2,$3,$4)", [id, login, `User ${login}`, role]);
  }

  // one lead for every situation, deliberately inserted in scrambled order
  await lead("MH01Q0010", "later-cb-2", { status: "callback", callback: at(300) });
  await lead("MH01Q0011", "no-answer-new", { status: "no_answer", called: at(-60) });
  await lead("MH01Q0012", "new-second", { created: at(-500) });
  await lead("MH01Q0013", "due-recent", { status: "callback", callback: at(-5) });
  await lead("MH01Q0014", "no-answer-old", { status: "no_answer", called: at(-3000) });
  await lead("MH01Q0015", "later-cb-1", { status: "callback", callback: at(60) });
  await lead("MH01Q0016", "new-first", { created: at(-900) });
  await lead("MH01Q0017", "due-old", { status: "callback", callback: at(-120) });
  await lead("MH01Q0018", "interested-no-cb", { status: "interested", called: at(-10) });
  await lead("MH01Q0019", "sold-one", { status: "sold", called: at(-20) });
  await lead("MH01Q0020", "not-int", { status: "not_interested", called: at(-30) });
  await lead("MH01Q0021", "interested-due", { status: "interested", callback: at(-1) }); // interested, with a callback now due
  // must never appear
  await lead("MH01Q0030", "dnd-flag", { dnd: true, status: "do_not_call" });
  await lead("MH01Q0031", "other-callers", { owner: OTHER });
  await lead("MH01Q0032", "unassigned", { owner: null });
});

describe("ranking", () => {
  it("orders: due callbacks, new, no answer, later callbacks", async () => {
    expect(names(await queue("todo"))).toEqual([
      "due-old", "due-recent", "interested-due", // 1: due now, oldest callback first
      "new-first", "new-second",                 // 2: new, first loaded first
      "no-answer-old", "no-answer-new",          // 3: oldest attempt first
      "later-cb-1", "later-cb-2",                // 4: later callbacks, soonest first
    ]);
  });

  it("never shows do-not-call, other callers' or unassigned leads", async () => {
    const all = [...names(await queue("todo")), ...names(await queue("interested")), ...names(await queue("closed"))];
    for (const hidden of ["dnd-flag", "other-callers", "unassigned"]) expect(all).not.toContain(hidden);
  });

  it("keeps worked and closed leads out of the to-do list", async () => {
    const todo = names(await queue("todo"));
    for (const x of ["interested-no-cb", "sold-one", "not-int"]) expect(todo).not.toContain(x);
  });
});

describe("filters and counts", () => {
  it("each filter returns its own bucket", async () => {
    expect(names(await queue("due"))).toEqual(["due-old", "due-recent", "interested-due"]);
    expect(names(await queue("new"))).toEqual(["new-first", "new-second"]);
    expect(names(await queue("no_answer"))).toEqual(["no-answer-old", "no-answer-new"]);
    expect(names(await queue("callbacks"))).toEqual(["later-cb-1", "later-cb-2"]);
    expect(names(await queue("interested"))).toEqual(["interested-no-cb"]);
    expect(names(await queue("closed"))).toEqual(["sold-one", "not-int"]);
    expect(await queue("bogus")).toEqual([]);
  });

  it("chip counts match the lists", async () => {
    const c = await asUser(CALLER, async () => (await q("select * from public.my_queue_counts()")).rows[0]);
    expect(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]))).toEqual({
      todo: 9, due: 3, new: 2, no_answer: 2, callbacks: 2, interested: 1, closed: 2,
    });
  });
});

describe("paging", () => {
  it("pages are consecutive and total_count is the whole list", async () => {
    const p1 = await queue("todo", null, 4, 0);
    const p2 = await queue("todo", null, 4, 4);
    const p3 = await queue("todo", null, 4, 8);
    expect([...names(p1), ...names(p2), ...names(p3)]).toEqual(names(await queue("todo")));
    expect(p1.map((r) => Number(r.total_count))).toEqual([9, 9, 9, 9]);
    expect(p3).toHaveLength(1);
  });

  it("caps the page size", async () => {
    expect((await queue("todo", null, 100000)).length).toBe(9);
  });
});

describe("search", () => {
  beforeAll(async () => {
    await lead("DL01SRCH001", "Sunita Rao", { phone: "9811122233", city: "Pune" });
    await lead("DL01SRCH002", "100% Percent_Man", { phone: "9822233344", city: "Noida" });
  });

  it("finds by name, number, city and registration number", async () => {
    expect(names(await queue("todo", "sunita"))).toEqual(["Sunita Rao"]);
    expect(names(await queue("todo", "9811122"))).toEqual(["Sunita Rao"]);
    expect(names(await queue("todo", "98 111-22"))).toEqual(["Sunita Rao"]); // spaces and dashes ignored
    expect(names(await queue("todo", "pune"))).toEqual(["Sunita Rao"]);
    expect(names(await queue("todo", "dl01 srch-001"))).toEqual(["Sunita Rao"]);
  });

  it("treats % and _ as ordinary characters, not wildcards", async () => {
    expect(names(await queue("todo", "100%"))).toEqual(["100% Percent_Man"]);
    expect(names(await queue("todo", "%"))).toEqual(["100% Percent_Man"]);
    expect(names(await queue("todo", "_"))).toEqual(["100% Percent_Man"]);
  });

  it("counts follow the search", async () => {
    const c = await asUser(CALLER, async () => (await q("select * from public.my_queue_counts('sunita')")).rows[0]);
    expect(Number(c.todo)).toBe(1);
  });
});

describe("a call moves the lead", () => {
  it("new -> callback later -> it lands in the later-callbacks list, and leaves the new list", async () => {
    const id = (await q("select id from public.leads where name = 'new-first'")).rows[0].id as string;
    await asUser(CALLER, async () => {
      await q("select public.log_call($1, 'callback', 'ring after lunch', $2)", [id, at(90)]);
    });
    expect(names(await queue("new"))).not.toContain("new-first");
    expect(names(await queue("callbacks"))).toContain("new-first");
  });

  it("a no-answer goes behind older attempts", async () => {
    const id = (await q("select id from public.leads where name = 'new-second'")).rows[0].id as string;
    await asUser(CALLER, async () => { await q("select public.log_call($1, 'no_answer')", [id]); });
    const na = names(await queue("no_answer"));
    expect(na[na.length - 1]).toBe("new-second"); // most recent attempt = last
  });

  it("do-not-call removes it from every list", async () => {
    const id = (await q("select id from public.leads where name = 'later-cb-2'")).rows[0].id as string;
    await asUser(CALLER, async () => { await q("select public.log_call($1, 'do_not_call')", [id]); });
    const everything = [...names(await queue("todo")), ...names(await queue("closed")), ...names(await queue("interested"))];
    expect(everything).not.toContain("later-cb-2");
  });
});

describe("history and other vehicles", () => {
  it("shows history to the owner with the caller's name, and not to anyone else", async () => {
    const id = (await q("select id from public.leads where name = 'new-second'")).rows[0].id as string;
    const mine = await asUser(CALLER, async () => (await q("select * from public.lead_history($1)", [id])).rows);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ outcome: "no_answer", caller_name: "User caller01" });
    const theirs = await asUser(OTHER, async () => (await q("select * from public.lead_history($1)", [id])).rows);
    expect(theirs).toHaveLength(0);
  });

  it("lists other vehicles on the same number, only for the owner", async () => {
    await lead("MH01TWIN001", "Twin A", { phone: "9877700001" });
    await lead("MH01TWIN002", "Twin A", { phone: "9877700001", owner: OTHER }); // second car, different caller
    const id = (await q("select id from public.leads where reg_no = 'MH01TWIN001'")).rows[0].id as string;
    const mine = await asUser(CALLER, async () => (await q("select * from public.other_vehicles($1)", [id])).rows);
    expect(mine.map((r) => r.reg_no)).toEqual(["MH01TWIN002"]);
    const theirs = await asUser(OTHER, async () => (await q("select * from public.other_vehicles($1)", [id])).rows);
    expect(theirs).toHaveLength(0);
  });

  it("anonymous users can't run any of it", async () => {
    await asUser(null, async () => {
      await expect(q("select * from public.my_queue()")).rejects.toThrow();
      await expect(q("select * from public.lead_history($1)", [CALLER])).rejects.toThrow();
    }, "anon");
  });
});
