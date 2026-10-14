// The one-file database setup (what a non-technical admin pastes into Supabase) must always equal
// the migrations, apply cleanly on a brand-new database, and the optional SQL files must work.
import { PGlite } from "@electric-sql/pglite";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "../../supabase");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  return db;
}

describe("supabase/bundle.sql", () => {
  it("is exactly the migrations, in order (run `npm run db:bundle` if this fails)", () => {
    const before = read("bundle.sql");
    execFileSync("node", [path.join(__dirname, "../../scripts/bundle-sql.mjs")], { stdio: "pipe" });
    expect(read("bundle.sql")).toBe(before);
    for (const f of readdirSync(path.join(root, "migrations")).filter((x) => x.endsWith(".sql"))) {
      expect(before).toContain(`-- ============================================================ ${f}`);
    }
  });

  it("applies cleanly to an empty database in one go", async () => {
    const db = await freshDb();
    await db.exec(read("bundle.sql"));
    const t = await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by 1");
    expect(t.rows.map((r) => r.table_name)).toEqual(["audit_log", "call_logs", "leads", "profiles", "upload_batches"]);
    // every table has row level security switched on
    const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'");
    expect(rls.rows.every((r) => r.relrowsecurity)).toBe(true);
    expect(rls.rows).toHaveLength(5);
  });

  it("no internal function is callable by signed-out or signed-in users except the intended ones", async () => {
    const db = await freshDb();
    await db.exec(read("bundle.sql"));
    const r = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
        and has_function_privilege('anon', p.oid, 'execute')`);
    expect(r.rows).toEqual([]); // nothing at all is open to the signed-out world
    const internal = await db.query<{ proname: string }>(`
      select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('write_audit','guard_dnd','audit_lead_delete','block_log_changes','touch_updated_at')
        and has_function_privilege('authenticated', p.oid, 'execute')`);
    expect(internal.rows).toEqual([]);
  });
});

describe("optional SQL files", () => {
  it("seed-demo.sql adds 20 valid fake leads and is safe to run twice", async () => {
    const db = await freshDb();
    await db.exec(read("bundle.sql"));
    await db.exec(read("seed-demo.sql"));
    await db.exec(read("seed-demo.sql"));
    const r = await db.query<{ n: number; first: string; last: string }>(
      "select count(*)::int n, min(phone) first, max(phone) last from public.leads where source = 'demo'");
    expect(r.rows[0]).toEqual({ n: 20, first: "9800000101", last: "9800000120" });
    const unassigned = await db.query("select 1 from public.leads where assigned_to is not null");
    expect(unassigned.rows).toHaveLength(0);
  });

  it("bootstrap-admin.sql turns the Auth user into an admin", async () => {
    const db = await freshDb();
    await db.exec(read("bundle.sql"));
    await db.exec("insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'admin@acme.in')");
    await db.exec(read("bootstrap-admin.sql").replaceAll("admin@YOUR-LOGIN-DOMAIN", "admin@acme.in"));
    const r = await db.query("select login_id, role, active from public.profiles");
    expect(r.rows).toEqual([{ login_id: "admin", role: "admin", active: true }]);
  });
});
