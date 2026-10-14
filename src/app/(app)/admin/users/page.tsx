import type { Metadata } from "next";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { CreateUserForm, UserRow } from "./user-forms";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, login_id, full_name, role, active, created_at")
    .order("role")
    .order("full_name");
  const users = (data ?? []) as Profile[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold">Users</h1>
        <p className="text-sm text-muted">Create logins for your team and manage who can sign in.</p>
      </header>

      <section aria-labelledby="new-user" className="card p-4">
        <h2 id="new-user" className="mb-3 font-semibold">Add a user</h2>
        <CreateUserForm />
      </section>

      <section aria-labelledby="all-users">
        <h2 id="all-users" className="mb-2 font-semibold">Everyone ({users.length})</h2>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            We couldn&apos;t load the user list. Refresh the page to try again.
          </p>
        )}
        <ul className="space-y-3">
          {users.map((u) => (
            <UserRow key={u.id} user={u} isSelf={u.id === me.id} />
          ))}
        </ul>
      </section>
    </div>
  );
}
