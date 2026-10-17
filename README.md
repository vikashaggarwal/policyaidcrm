# PolicyAid CRM

A web-based CRM for an outbound tele-sales team selling motor insurance renewals in India.
A manager uploads leads from Excel or CSV, telecallers work a ranked call queue from their phones,
and leadership sees the pipeline and caller performance.

It is a **website**, not an app store app. Callers open the link in their phone browser (and can add it to
their home screen if they like). Nothing runs on anyone's computer: the database, sign-in and hosting are all online.

**Built with:** Next.js · Supabase (Postgres, Auth, Row Level Security) · Vercel.

---

## Who can do what

| | Admin | Manager | Caller |
|---|:-:|:-:|:-:|
| See and work their own assigned leads, log calls, set callbacks, add a lead | | | ✅ |
| See every lead and every report | ✅ | ✅ | |
| Upload leads, assign and reassign | ✅ | ✅ | |
| Export leads and call logs (always audited) | ✅ | ✅ | |
| View the audit trail | ✅ | ✅ | |
| Delete leads | ✅ | | |
| Lift a do-not-call | ✅ | | |
| Create users, reset passwords, change roles, switch people off | ✅ | | |

These limits are enforced **inside the database** (Row Level Security), not just hidden in the screens, so they
hold even if someone calls the API directly.

---

## How the system behaves (decisions worth knowing)

- **One lead = one vehicle.** The registration number identifies a lead. An owner with two vehicles on one
  mobile number appears as two leads, and the caller sees a "this owner has N other vehicles" note.
- **Renewal date defaults to registration date + 5 days.** This is the rule you specified; callers can correct a renewal date, and an upload can supply one. To change it, see
  [Changing the renewal-date rule](#changing-the-renewal-date-rule).
- **Do not call is permanent.** It blocks that mobile number across *every* vehicle, removes it from all queues,
  and only an admin can lift it (audited). Callers cannot add a number that is on the list.
- **Wrong number** removes a lead from the caller's queue too (after a confirmation), but it is not a legal
  do-not-call: the number can still be loaded again once corrected. Other unworked leads on the same number are
  closed with it. A manager or admin can **Reopen** wrong-number leads from the Leads screen.
- **Message sent** records a WhatsApp, SMS or email sent to the customer. The lead stays in the caller's queue (alongside
  No answer) with an optional callback time, and it does not count as a connected call on the dashboard.
- **Call history can never be edited or deleted**, by anyone, including admins. The only way a call record
  disappears is when an admin deletes the whole lead, and that is audited.
- **Saving a call is one transaction:** the history row and the lead update succeed or fail together.
- **Queue order:** callbacks due now (oldest first) → new leads (first loaded, first called) → no-answer leads
  (oldest attempt first) → later callbacks (soonest first). Do-not-call leads never appear.
- **Times are India time** (IST), whatever the phone's clock says.
- **Mobile numbers** are cleaned to exactly 10 digits (+91, spaces, a leading 0, Excel numbers and scientific
  notation are handled) and must start with 6, 7, 8 or 9.
- **Uploads** read the first sheet of `.xlsx`, `.xls` or `.csv` (or pasted rows), match headers flexibly,
  show a preview with new / duplicate / invalid counts, and only then import. The `ASSIGNED TO` column
  (a caller's full name or login ID) assigns on import; anything unmatched is imported unassigned and listed in the preview.
- **No call recording** is built, and none should be added without legal advice.
- **No offline mode.** Lead data is personal and live, so nothing is cached on the phone.

---

## Compliance, before you load a single number

> **Check every number against the NDNC (National Do Not Call) registry before uploading.**
> PolicyAid CRM records a do-not-call outcome from each conversation, but it does **not** know which numbers are on
> the national registry. Telemarketing to registered numbers is a regulatory breach (TRAI's telecom commercial
> communications rules). Scrub files first, using your telecom provider's or a registered scrubbing service's tool.

- **Personal data.** Uploaded sheets hold names, addresses, mobile numbers and vehicle identifiers. This is personal
  data under India's Digital Personal Data Protection Act, 2023. Be able to show where the data came from and that you
  may use it for this purpose. Keep exports to the minimum needed. Every export is recorded in the audit trail.
- **Retention.** Decide how long lead data is kept and delete what you no longer need (admins can delete leads).
- **Staff.** Switch off anyone who leaves the same day (Users → Switch off). They are signed out immediately.

---

# Deployment: online, step by step

You need three free accounts: **GitHub** (your code is already there), **Supabase** (database and sign-in) and
**Vercel** (hosting). About 30 minutes. You never run anything on your own computer.

> **Free tier warning.** Supabase pauses free projects after about a week of no activity, and free projects have no
> daily backups. For real use, put the Supabase project on the **Pro** plan before go-live.

## 1. The code

The repository is `vikashaggarwal/policyaidcrm`, and the app is at the top level of it. Vercel deploys the `main` branch.

## 2. Create the Supabase project

1. supabase.com → **New project**. Name it `policyaid-crm`.
2. **Region: South Asia (Mumbai)**: fastest for your team and keeps data in India.
3. Set a strong **database password** and save it in your password manager. You will not need it for the app.
4. Wait about two minutes for the project to start.

## 3. Create the database (one paste)

1. In Supabase open **SQL Editor → New query**.
2. On GitHub open `supabase/bundle.sql`, click **Copy raw file**, paste it into the editor, press **Run**.
3. You should see "Success. No rows returned". If you see a red error, stop and send it to me. Do not run it twice.
4. Check: **Table Editor** should list `audit_log`, `call_logs`, `leads`, `profiles`, `upload_batches`, each marked with RLS enabled.

## 4. Switch off public sign-up (important)

Nobody should be able to create their own login. In Supabase: **Authentication → Sign In / Providers** (or
"Providers" / "Settings"), and turn **off "Allow new users to sign up"**. If you can't find it, search the Authentication
settings for "sign up". Leave the **Email** provider itself *on* (that is how password login works).

## 5. Collect your keys

Supabase → **Project Settings → API Keys** (or "API"). You need three values:

| Value | Where it comes from | Used for |
|---|---|---|
| Project URL | looks like `https://abcd1234.supabase.co` | `NEXT_PUBLIC_SUPABASE_URL` |
| **Publishable** key (older name: *anon*) | starts `sb_publishable_…` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |
| **Secret** key (older name: *service_role*) | starts `sb_secret_…`. **Keep private.** | `SUPABASE_SERVICE_ROLE_KEY` |

The publishable key is safe in the browser because Row Level Security protects the data. The secret key can bypass
all protections: it is used in exactly one place (the admin's user-management screen), only on the server, and the build
fails if anyone tries to use it in browser code. **Never paste it into chat, email or the repo.**

You also choose a **login domain**: any domain you own, e.g. `yourcompany.in`. People type a short login ID like
`caller07`; Supabase needs an email, so PolicyAid CRM uses `caller07@yourcompany.in` behind the scenes. **No email is ever
sent**, and you don't need a mailbox. Choose it once and never change it afterwards.

## 6. Deploy on Vercel

1. vercel.com → **Add New… → Project → Import Git Repository** → pick `policyaidcrm`.
2. Leave **Root Directory** as it is (the app is at the top of the repository). Framework should show *Next.js*.
3. Open **Environment Variables** and add all four:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | your publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | your secret key |
   | `NEXT_PUBLIC_LOGIN_DOMAIN` | your login domain, e.g. `yourcompany.in` |

4. Press **Deploy**. When it finishes you get an address like `https://policyaidcrm-xyz.vercel.app`.

Variables beginning `NEXT_PUBLIC_` are baked in at build time, so if you ever change one, **Redeploy**.

## 7. Create the first admin

1. Supabase → **Authentication → Users → Add user → Create new user**: email `admin@yourcompany.in`
   (your login domain), a strong password, and tick **Auto Confirm User**.
2. SQL Editor → paste `supabase/bootstrap-admin.sql`, change `YOUR-LOGIN-DOMAIN` to your domain, **Run**.
   The final query should show one row: `admin | admin | true`.
3. Open your Vercel address and sign in with login ID **`admin`** and that password.

From here, everything happens inside PolicyAid CRM: **Users → Add a user** creates managers and callers with a login ID
and password. **Reset password** and **Switch off** are on the same page. There is no "forgot password" email, so
resets go through the admin.

## 8. (Optional) Try it with fake data

Paste `supabase/seed-demo.sql` into the SQL Editor and run it. It adds 20 clearly fake leads (mobile numbers
`9800000101`–`9800000120`). Create a demo caller in Users, then use **Leads → Reassign** to give the leads to them.
Delete the demo leads before go-live.

## 9. Production verification checklist

Do these on the live address, in order. Tick each one. Anything that fails: stop and tell me which.

**Sign-in and roles**
- [ ] The address loads over `https://` and shows the PolicyAid CRM sign-in page.
- [ ] Wrong password → plain message "That login ID or password isn't right". No technical text.
- [ ] Admin signs in and lands on the Dashboard. Nav shows Dashboard · Leads · Audit · Users.
- [ ] Users → add a **manager** (`manager1`) and a **caller** (`caller01`) with passwords.
- [ ] Sign in as `manager1`: nav shows Dashboard · Leads · Audit (no Users). Opening `/admin/users` bounces to the dashboard.
- [ ] Sign in as `caller01`: lands on **Queue**, with no Dashboard, Leads or Audit. Typing `/dashboard` in the address bar bounces back to the queue.
- [ ] **Switch off** `caller01` as admin, then try to sign in as them → refused. Switch them back on.
- [ ] Public sign-up is off: Supabase → Authentication → Users lists **only** the people you created, and the "Allow new users to sign up" toggle (step 4) is off.

**Upload**
- [ ] Leads → Upload leads → **Download sample Excel template**.
- [ ] Fill 3 rows (one with `ASSIGNED TO` = `caller01`, one blank, one with a name that doesn't exist) and upload it.
- [ ] Preview shows New 3 · Duplicate 0 · Invalid 0, and an assignment box showing `caller01` 1, 1 blank, and the unmatched name flagged.
- [ ] Import. Summary says 3 added. Upload it again → Duplicate 3, nothing new.
- [ ] Add a row with a bad mobile number → shows Invalid with a reason; "Download invalid rows" works.

**Test call**
- [ ] As `caller01` the assigned lead is in **Queue**, and the other two are not.
- [ ] Tap it. The sheet shows every detail, a **Call** button and **Copy number**.
- [ ] Choose **Call back**, press Save with no time → asked to pick a time. Pick "Tomorrow 10 am", add a note, **Save**. Toast says saved.
- [ ] Reopen the lead: the history shows your call, the note and the callback time. It sits under **Callbacks**.
- [ ] Add a lead with **+ Add lead** using only a name and mobile. It appears in the queue.
- [ ] Choose **Do not call** on one lead → asked to confirm → Save. It disappears from every list.

**Managers**
- [ ] As `manager1`, Dashboard shows the numbers moving (leads loaded, called, the caller's row).
- [ ] Leads → select a lead → give it to `caller01`; also try **Reassign all unworked leads** (shows how many first).
- [ ] **Export Excel** downloads; open it, the 16 sheet columns come first and mobile numbers are intact.
- [ ] Audit lists the upload, the reassignment, the export and the do-not-call, with who and when.
- [ ] As admin, delete one test lead (Leads → tick it → Delete → confirm); the Audit shows the deletion. A manager sees no Delete button.

**Database protection (the important one)**
- [ ] In a terminal-free way: open a private browser window and paste this into the address bar, replacing the two values:
  `https://YOUR-PROJECT.supabase.co/rest/v1/leads?select=*&apikey=YOUR-PUBLISHABLE-KEY`
  You must see `[]` or a permission error, **never any leads**. (Signed out, the database must give nothing.)

## Costs and limits

- Supabase Free and Vercel Hobby are enough to try it. Plan on **Supabase Pro** (daily backups, no pausing) for live work.
- Vercel's Hobby plan is for non-commercial use; a commercial team needs the **Pro** plan.
- One upload can hold 30,000 rows and 10 MB. For 25,000 leads that's one file.
- Supabase limits how fast sign-in can be attempted, which slows password guessing.

---

## Running the team day to day

- **New caller:** Users → Add a user → role Caller → give them the login ID and password. Then Leads → assign them leads.
- **A caller leaves:** Users → **Switch off** (signed out at once) → Leads → **Reassign all unworked leads from** them. Worked leads can be moved from the Leads list too.
- **Forgot password:** Users → Reset password → share the new one securely.
- **Backups:** Supabase Pro keeps daily backups. Export leads and call logs regularly if you want your own copy.
- **Changing a key:** if a secret key is ever exposed, Supabase → API Keys → rotate it, update `SUPABASE_SERVICE_ROLE_KEY` in Vercel and Redeploy.

## Changing the renewal-date rule

The renewal date is a normal column. When a lead has a registration date but no renewal date, a database trigger
sets it to registration date + 5 days. To use a different number of days, run this in the SQL Editor
(replace `5` with your number):

```sql
create or replace function public.set_renewal_date()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.renewal_date is null and new.reg_date is not null then new.renewal_date := new.reg_date + 5; end if;
  elsif new.reg_date is distinct from old.reg_date and new.reg_date is not null
        and new.renewal_date is not distinct from old.renewal_date
        and coalesce(current_setting('app.renewal_explicit', true), '') <> '1' then
    new.renewal_date := new.reg_date + 5;
  end if;
  return new;
end $$;
```


## For developers

```bash
npm install
npm test            # 190+ tests, including the database access rules on a real in-memory Postgres
npm run lint && npx tsc --noEmit
npm run dev
```

| Path | What |
|---|---|
| `supabase/migrations/` | `0001` tables · `0002` functions, triggers, call logging · `0003` Row Level Security · `0004` uploads · `0005` queue · `0006` reports and exports · `0007` search fix · `0008` caller-added leads |
| `supabase/bundle.sql` | All migrations in one file for pasting. Regenerate with `npm run db:bundle`; a test fails if it is stale |
| `supabase/bootstrap-admin.sql`, `seed-demo.sql` | Online setup helpers (steps 7 and 8) |
| `src/proxy.ts` | Refreshes sign-in and sends signed-out visitors to `/login` (Next.js 16 calls middleware "proxy") |
| `src/lib/supabase/admin.ts` | The only use of the secret key. `server-only`, so the build fails if it reaches the browser |
| `src/lib/upload/` | Header matching, phone and date cleaning, row validation (shared by the preview and the server) |
| `scripts/seed.ts` | Optional developer seed (`npm run seed`) for use with a `.env.local` |
| `tests/db/` | Attacks the access rules: isolation, append-only history, permanent do-not-call, audit |

Copy `.env.example` to `.env.local` for local work. **Never commit real values.**

**Adding a migration:** create `supabase/migrations/0009_name.sql`, run `npm run db:bundle`, commit both. For an
already-deployed database, paste only the new migration into the SQL Editor, never the whole bundle again.

**Security summary:** Row Level Security on every table · callers can write only through `log_call` and `add_lead`,
which check ownership · call and audit logs are append-only (blocked by triggers even for admins) · the secret key is
confined to one server-only module · every input is validated again on the server · queries are parameterised ·
output is escaped by React · exports defuse spreadsheet formulas · security headers are set (no framing, no sniffing,
HTTPS only). Database errors are turned into plain sentences; raw error text is never shown.

**Known limitation: spreadsheet library.** The npm release of `xlsx` (0.18.5) has published advisories and no
patched version on npm. Files are parsed only in the signed-in manager's own browser, with size and row caps, which
limits the exposure. Before wide use, switch to SheetJS's patched build:
`npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (Vercel and GitHub can reach that address), commit
the updated `package.json` and lock file, and redeploy.
