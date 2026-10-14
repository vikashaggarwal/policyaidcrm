// Runs the real migrations on an in-memory Postgres and attacks the access rules.
// Supabase's auth layer is stood in for by a tiny stub (auth.uid() reads a session setting).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const MANAGER = "00000000-0000-0000-0000-0000000000b1";
const CALLER1 = "00000000-0000-0000-0000-0000000000c1";
const CALLER2 = "00000000-0000-0000-0000-0000000000c2";
const INACTIVE = "00000000-0000-0000-0000-0000000000d1";

let db: PGlite;

async function as(uid: string | null, role: "authenticated" | "anon" | "postgres" = "authenticated") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  if (role !== "postgres") await db.exec(`set role ${role};`);
}

/** Run fn as the user, always restoring the superuser afterwards. */
async function run<T>(uid: string | null, fn: () => Promise<T>, role: "authenticated" | "anon" = "authenticated") {
  await as(uid, role);
  try {
    return await fn();
  } finally {
    await as(null, "postgres");
  }
}

const q = (sql: string, params?: unknown[]) => db.query<Record<string, unknown>>(sql, params);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  const dir = path.join(__dirname, "../../supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
  }

  for (const [id, login, role, active] of [
    [ADMIN, "admin", "admin", true],
    [MANAGER, "manager1", "manager", true],
    [CALLER1, "caller01", "caller", true],
    [CALLER2, "caller02", "caller", true],
    [INACTIVE, "caller99", "caller", false],
  ] as const) {
    await q("insert into auth.users (id) values ($1)", [id]);
    await q("insert into public.profiles (id, login_id, full_name, role, active) values ($1,$2,$3,$4,$5)", [
      id, login, `User ${login}`, role, active,
    ]);
  }

  // phones deliberately shared: two vehicles, one owner (9800000101)
  const leads = [
    ["MH01AA0001", "9800000101", CALLER1, "new"],
    ["MH01AA0002", "9800000101", CALLER1, "new"],
    ["MH01AA0003", "9800000102", CALLER1, "new"],
    ["MH01AA0004", "9800000103", CALLER2, "new"],
    ["MH01AA0005", "9800000104", null, "new"],
  ];
  for (const [reg, phone, owner, status] of leads) {
    await q(
      "insert into public.leads (reg_no, name, phone, assigned_to, status, reg_date) values ($1,'Test Owner',$2,$3,$4,'2026-01-10')",
      [reg, phone, owner, status],
    );
  }
});

const leadId = async (reg: string) => (await q("select id from public.leads where reg_no = $1", [reg])).rows[0].id as string;

describe("schema rules", () => {
  it("derives policy expiry as registration date + 5 days", async () => {
    const r = await q("select policy_expiry::text as e from public.leads where reg_no = 'MH01AA0001'");
    expect(r.rows[0].e).toBe("2026-01-15");
  });

  it("rejects bad phones and duplicate registration numbers", async () => {
    await expect(q("insert into public.leads (reg_no, name, phone) values ('MH01ZZ0001','x','12345')")).rejects.toThrow();
    await expect(q("insert into public.leads (reg_no, name, phone) values ('MH01AA0001','x','9800000199')")).rejects.toThrow();
  });
});

describe("caller isolation", () => {
  it("sees only their own leads", async () => {
    const rows = await run(CALLER1, async () => (await q("select reg_no from public.leads order by reg_no")).rows);
    expect(rows.map((r) => r.reg_no)).toEqual(["MH01AA0001", "MH01AA0002", "MH01AA0003"]);
  });

  it("cannot edit, insert or delete leads directly", async () => {
    await run(CALLER1, async () => {
      const upd = await q("update public.leads set phone = '9000000000' where reg_no = 'MH01AA0001'");
      expect(upd.affectedRows).toBe(0);
      await expect(q("insert into public.leads (reg_no, name, phone) values ('MH01XX0001','x','9800000150')")).rejects.toThrow();
      const del = await q("delete from public.leads where reg_no = 'MH01AA0001'");
      expect(del.affectedRows).toBe(0);
    });
  });

  it("cannot call log_call on another caller's lead", async () => {
    const id = await leadId("MH01AA0004");
    await run(CALLER1, async () => {
      await expect(q("select public.log_call($1, 'interested')", [id])).rejects.toThrow(/not_allowed/);
    });
  });

  it("cannot read another caller's data, read profiles of others, or promote themselves", async () => {
    await run(CALLER1, async () => {
      expect((await q("select id from public.profiles")).rows).toHaveLength(1);
      const r = await q("update public.profiles set role = 'admin' where id = $1", [CALLER1]);
      expect(r.affectedRows).toBe(0);
      expect((await q("select * from public.audit_log")).rows).toHaveLength(0);
      expect((await q("select * from public.upload_batches")).rows).toHaveLength(0);
    });
  });

  it("anonymous users and deactivated users see nothing", async () => {
    await run(null, async () => {
      await expect(q("select * from public.leads")).rejects.toThrow();
    }, "anon");
    await run(INACTIVE, async () => {
      expect((await q("select * from public.leads")).rows).toHaveLength(0);
    });
  });
});

describe("log_call", () => {
  it("writes history and updates the lead together", async () => {
    const id = await leadId("MH01AA0003");
    const cb = new Date(Date.now() + 3600_000).toISOString();
    await run(CALLER1, async () => {
      await q("select public.log_call($1, 'callback', 'asked to ring later', $2)", [id, cb]);
    });
    const lead = (await q("select status, attempts, callback_at, last_called_at from public.leads where id = $1", [id])).rows[0];
    expect(lead.status).toBe("callback");
    expect(lead.attempts).toBe(1);
    expect(lead.callback_at).not.toBeNull();
    expect(lead.last_called_at).not.toBeNull();
    const logs = (await q("select outcome, note, caller_id from public.call_logs where lead_id = $1", [id])).rows;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ outcome: "callback", note: "asked to ring later", caller_id: CALLER1 });
  });

  it("requires a future time for callbacks", async () => {
    const id = await leadId("MH01AA0002");
    await run(CALLER1, async () => {
      await expect(q("select public.log_call($1, 'callback')", [id])).rejects.toThrow(/callback_required/);
      await expect(
        q("select public.log_call($1, 'callback', null, now() - interval '1 day')", [id]),
      ).rejects.toThrow(/callback_in_past/);
    });
    // a failed attempt leaves no trace
    expect((await q("select count(*)::int as n from public.call_logs where lead_id = $1", [id])).rows[0].n).toBe(0);
  });

  it("do-not-call blocks every lead on that number and hides it from the caller", async () => {
    const id = await leadId("MH01AA0001");
    await run(CALLER1, async () => {
      await q("select public.log_call($1, 'do_not_call', 'asked not to be called')", [id]);
      const visible = (await q("select reg_no from public.leads order by reg_no")).rows.map((r) => r.reg_no);
      expect(visible).not.toContain("MH01AA0001");
      expect(visible).not.toContain("MH01AA0002"); // same phone, other vehicle
      await expect(q("select public.log_call($1, 'interested')", [id])).rejects.toThrow(/lead_blocked/);
    });
    const sibling = (await q("select dnd, status from public.leads where reg_no = 'MH01AA0002'")).rows[0];
    expect(sibling).toMatchObject({ dnd: true, status: "do_not_call" });
  });
});

describe("append-only history and audit", () => {
  it("an admin cannot edit or delete call logs or the audit log (no policy allows it)", async () => {
    const before = (await q("select count(*)::int as n from public.call_logs")).rows[0].n;
    await run(ADMIN, async () => {
      expect((await q("update public.call_logs set note = 'tampered'")).affectedRows).toBe(0);
      expect((await q("delete from public.call_logs")).affectedRows).toBe(0);
      expect((await q("update public.audit_log set action = 'x'")).affectedRows).toBe(0);
      expect((await q("delete from public.audit_log")).affectedRows).toBe(0);
    });
    expect((await q("select count(*)::int as n from public.call_logs")).rows[0].n).toBe(before);
  });

  it("even a superuser that bypasses RLS is stopped by the append-only triggers", async () => {
    await as(null, "postgres");
    await expect(q("update public.call_logs set note = 'tampered'")).rejects.toThrow(/append_only/);
    await expect(q("delete from public.call_logs")).rejects.toThrow(/append_only/);
    await expect(q("update public.audit_log set action = 'x'")).rejects.toThrow(/append_only/);
    await expect(q("delete from public.audit_log")).rejects.toThrow(/append_only/);
  });

  it("users cannot forge audit entries", async () => {
    await run(CALLER1, async () => {
      await expect(q("select public.write_audit('x','y','z','{}')")).rejects.toThrow();
      await expect(q("insert into public.audit_log (action, entity) values ('x','y')")).rejects.toThrow();
    });
  });
});

describe("do-not-call is permanent", () => {
  it("a manager cannot lift it; an admin can, and it is audited", async () => {
    const id = await leadId("MH01AA0002");
    await run(MANAGER, async () => {
      await expect(q("update public.leads set dnd = false, status = 'new' where id = $1", [id])).rejects.toThrow(/dnd_locked/);
    });
    await run(ADMIN, async () => {
      await q("update public.leads set dnd = false, status = 'new' where id = $1", [id]);
    });
    const a = await q("select actor_id from public.audit_log where action = 'unblock_dnd'");
    expect(a.rows.length).toBeGreaterThan(0);
  });
});

describe("manager and admin powers", () => {
  it("manager sees all leads and the audit trail", async () => {
    await run(MANAGER, async () => {
      expect((await q("select * from public.leads")).rows.length).toBe(5);
      expect((await q("select * from public.audit_log")).rows.length).toBeGreaterThan(0);
    });
  });

  it("manager can reassign (audited) but callers cannot", async () => {
    const id = await leadId("MH01AA0005");
    await run(CALLER1, async () => {
      await expect(q("select public.reassign_leads($1, $2)", [[id], CALLER1])).rejects.toThrow(/not_allowed/);
    });
    await run(MANAGER, async () => {
      const r = await q("select public.reassign_leads($1, $2) as n", [[id], CALLER2]);
      expect(r.rows[0].n).toBe(1);
      await expect(q("select public.reassign_leads($1, $2)", [[id], MANAGER])).rejects.toThrow(/invalid_target/);
      await expect(q("select public.reassign_leads($1, $2)", [[id], INACTIVE])).rejects.toThrow(/invalid_target/);
    });
    const a = await q("select actor_id, details from public.audit_log where action = 'reassign'");
    expect(a.rows[0].actor_id).toBe(MANAGER);
  });

  it("reassign-all-unworked moves only never-called, non-DND leads", async () => {
    await run(MANAGER, async () => {
      const r = await q("select public.reassign_unworked($1, $2) as n", [CALLER1, CALLER2]);
      // CALLER1 still owns: AA0001 (dnd), AA0002 (unblocked, new, unworked), AA0003 (called)
      expect(r.rows[0].n).toBe(1);
    });
    const owners = (await q("select reg_no, assigned_to from public.leads where reg_no in ('MH01AA0002','MH01AA0003') order by reg_no")).rows;
    expect(owners[0].assigned_to).toBe(CALLER2);
    expect(owners[1].assigned_to).toBe(CALLER1);
  });

  it("only an admin can delete leads, and deletion is audited", async () => {
    const id = await leadId("MH01AA0003"); // has call history
    await run(MANAGER, async () => {
      expect((await q("delete from public.leads where id = $1", [id])).affectedRows).toBe(0);
    });
    await run(ADMIN, async () => {
      expect((await q("delete from public.leads where id = $1", [id])).affectedRows).toBe(1);
    });
    const a = await q("select actor_id, details from public.audit_log where action = 'delete_lead' and entity_id = $1", [id]);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actor_id).toBe(ADMIN);
  });

  it("uploads are audited with the real count, and only staff can run them", async () => {
    await run(CALLER1, async () => {
      await expect(q("select public.begin_upload('x.csv', 10)")).rejects.toThrow(/not_allowed/);
      await expect(
        q("insert into public.upload_batches (uploaded_by, filename) values ($1, 'x.csv')", [CALLER1]),
      ).rejects.toThrow();
    });

    let batch = "";
    await run(MANAGER, async () => {
      batch = (await q("select public.begin_upload('x.csv', 10) as id")).rows[0].id as string;
    });
    await q("insert into public.leads (reg_no, name, phone, batch_id) values ('MH01UP0001','x','9800000151',$1), ('MH01UP0002','x','9800000152',$1)", [batch]);

    await run(CALLER1, async () => {
      await expect(q("select public.finish_upload($1, 0, 0)", [batch])).rejects.toThrow(/not_allowed/);
    });
    await run(MANAGER, async () => {
      // the browser claims nothing about "added": the database counts it
      const r = await q("select * from public.finish_upload($1, 3, 5)", [batch]);
      expect(r.rows[0]).toMatchObject({ added: 2, duplicates: 3, invalid: 5, total_rows: 10 });
      await expect(q("select public.finish_upload($1, 0, 0)", [batch])).rejects.toThrow(/already_finished/);
    });
    const a = await q("select actor_id, details from public.audit_log where action = 'upload'");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].actor_id).toBe(MANAGER);
    expect((a.rows[0].details as { added: number }).added).toBe(2);
  });

  it("existing_reg_nos finds duplicates for staff, and only a caller's own for callers", async () => {
    await run(MANAGER, async () => {
      const r = await q("select * from public.existing_reg_nos($1)", [["MH01AA0004", "MH01AA0005", "NOPE0001"]]);
      expect(r.rows.map((x) => Object.values(x)[0]).sort()).toEqual(["MH01AA0004", "MH01AA0005"]);
    });
    await run(CALLER1, async () => {
      const r = await q("select * from public.existing_reg_nos($1)", [["MH01AA0004", "MH01AA0005"]]);
      expect(r.rows).toHaveLength(0); // someone else's / unassigned leads stay invisible
    });
  });
});
