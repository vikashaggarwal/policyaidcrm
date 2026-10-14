/**
 * Creates the first admin, two demo callers, a demo manager, and 20 clearly fake leads.
 * Safe to run more than once. Run:  npm run seed   (reads .env.local)
 * Demo logins get random passwords, printed ONCE below. Delete the demo users before go-live.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing ${k}. See .env.example.`);
  return v;
};

const url = need("NEXT_PUBLIC_SUPABASE_URL");
const sb = createClient(url, need("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false },
});
const domain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dialdesk.app";
const adminLogin = (process.env.SEED_ADMIN_LOGIN || "admin").trim().toLowerCase();
const adminPassword = need("SEED_ADMIN_PASSWORD");
if (adminPassword.length < 8) throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");

const randomPassword = () => randomBytes(9).toString("base64url");

async function ensureUser(login: string, fullName: string, role: "admin" | "manager" | "caller", password: string) {
  const { data: existing } = await sb.from("profiles").select("id").eq("login_id", login).maybeSingle();
  if (existing) return { id: existing.id as string, created: false };

  const { data, error } = await sb.auth.admin.createUser({
    email: `${login}@${domain}`,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Could not create ${login}: ${error?.message}`);
  const { error: pErr } = await sb
    .from("profiles")
    .insert({ id: data.user.id, login_id: login, full_name: fullName, role, active: true });
  if (pErr) {
    await sb.auth.admin.deleteUser(data.user.id);
    throw new Error(`Could not create profile for ${login}: ${pErr.message}`);
  }
  return { id: data.user.id, created: true };
}

const makes: [string, string, string, string][] = [
  ["MARUTI SUZUKI", "SWIFT VXI", "M-CYCLE/SCOOTER", "PETROL"],
  ["HYUNDAI", "CRETA SX", "MOTOR CAR", "DIESEL"],
  ["TATA MOTORS", "NEXON XZ+", "MOTOR CAR", "PETROL"],
  ["HONDA", "ACTIVA 6G", "M-CYCLE/SCOOTER", "PETROL"],
  ["MAHINDRA", "XUV700 AX7", "MOTOR CAR", "DIESEL"],
  ["BAJAJ", "PULSAR 150", "M-CYCLE/SCOOTER", "PETROL"],
  ["TOYOTA", "INNOVA CRYSTA", "MOTOR CAR", "DIESEL"],
  ["TVS", "JUPITER", "M-CYCLE/SCOOTER", "PETROL"],
];
const places: [string, string, string][] = [
  ["MAHARASHTRA", "MH12", "Pune"],
  ["DELHI", "DL01", "New Delhi"],
  ["KARNATAKA", "KA03", "Bengaluru"],
  ["GUJARAT", "GJ01", "Ahmedabad"],
  ["UTTAR PRADESH", "UP16", "Noida"],
];

async function main() {
  const admin = await ensureUser(adminLogin, "Admin", "admin", adminPassword);
  const mPw = randomPassword(), c1Pw = randomPassword(), c2Pw = randomPassword();
  const manager = await ensureUser("manager1", "Demo Manager", "manager", mPw);
  const c1 = await ensureUser("caller01", "Demo Caller One", "caller", c1Pw);
  const c2 = await ensureUser("caller02", "Demo Caller Two", "caller", c2Pw);

  const ordinal = ["One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
    "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen","Twenty"];
  const leads = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1;
    const [make, model, cls, fuel] = makes[i % makes.length];
    const [state, rto, city] = places[i % places.length];
    const regDate = new Date(Date.UTC(2026, 8, 1 + (i % 28)));
    return {
      state,
      reg_no: `${rto}FAKE${String(n).padStart(4, "0")}`,
      rto_code: rto,
      reg_date: regDate.toISOString().slice(0, 10),
      name: `DEMO OWNER ${ordinal[i].toUpperCase()}`,
      guardian_name: `DEMO GUARDIAN ${ordinal[i].toUpperCase()}`,
      address: `${n} Example Street, ${city} (fake address)`,
      engine_no: `FAKEENG${String(n).padStart(5, "0")}`,
      chassis_no: `FAKECHS${String(n).padStart(5, "0")}`,
      vehicle_make: make,
      vehicle_model: model,
      vehicle_class: cls,
      fuel,
      sale_amount: 60000 + n * 25000,
      seat_capacity: cls === "MOTOR CAR" ? 5 : 2,
      phone: `98000001${String(n).padStart(2, "0")}`,
      city,
      source: "seed",
      assigned_to: n <= 8 ? c1.id : n <= 16 ? c2.id : null,
    };
  });

  const { error } = await sb.from("leads").upsert(leads, { onConflict: "reg_no", ignoreDuplicates: true });
  if (error) throw new Error(`Could not insert demo leads: ${error.message}`);

  console.log("\nDone.");
  console.log(`  Admin   : ${adminLogin}  (password from SEED_ADMIN_PASSWORD)${admin.created ? "" : "  [already existed]"}`);
  for (const [label, login, u, pw] of [
    ["Manager", "manager1", manager, mPw],
    ["Caller ", "caller01", c1, c1Pw],
    ["Caller ", "caller02", c2, c2Pw],
  ] as const) {
    console.log(`  ${label} : ${login}  ${u.created ? `password: ${pw}` : "[already existed, password unchanged]"}`);
  }
  console.log("  Leads   : 20 demo leads (phones 9800000101-9800000120), 8 + 8 assigned, 4 unassigned");
  console.log("\nDemo users are for testing only. Switch them off in Users before go-live.");
}

main().catch((e) => {
  console.error(`\nSeed failed: ${e.message}`);
  process.exit(1);
});
