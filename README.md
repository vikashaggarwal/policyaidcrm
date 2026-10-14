# Dial Desk

Mobile-first CRM for an outbound tele-sales team (motor insurance renewals, India).
Next.js (App Router) + Supabase (Postgres, Auth, Row Level Security) + Vercel.

> **Status: Phase 1 of 5 complete** (scaffold, database, access rules, login, user admin, seed).
> The full README, including the deployment walkthrough, is written in Phase 5.

## Run the database tests

The access rules are tested against a real in-memory Postgres, no Supabase account needed:

```bash
npm install
npm test
```

## Layout

| Path | What |
|---|---|
| `supabase/migrations/` | `0001` tables, `0002` functions and triggers, `0003` Row Level Security. Run in order. |
| `src/proxy.ts` | Refreshes the session; sends signed-out visitors to `/login` |
| `src/lib/supabase/admin.ts` | Service-role client. `server-only`; used solely by admin user management |
| `scripts/seed.ts` | First admin + demo users + 20 fake leads (`npm run seed`) |
| `tests/db/rls.test.ts` | Attacks the access rules: isolation, append-only logs, permanent DND |

Copy `.env.example` to `.env.local` and fill it in. Never commit real values.
