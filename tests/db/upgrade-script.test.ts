// The one-off upgrade script a live database runs must work on top of migrations 0001-0008 and keep existing data.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("upgrade-0009-0010.sql upgrades a database at 0008 and carries expiry dates across", async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  const dir = path.join(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => /^000[1-8]/.test(x)).sort()) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  await db.exec("insert into public.leads (reg_no, name, phone, reg_date) values ('MH01UP0001','x','9855555555','2026-01-10')");
  await db.exec(readFileSync(path.join(__dirname, "../../supabase/upgrade-0009-0010.sql"), "utf8"));
  const r = await db.query<{ d: string }>("select renewal_date::text d from public.leads where reg_no = 'MH01UP0001'");
  expect(r.rows[0].d).toBe("2026-01-15");
  const fn = await db.query("select 1 from pg_proc where proname in ('update_lead','reopen_leads')");
  expect(fn.rows.length).toBe(2);
});
