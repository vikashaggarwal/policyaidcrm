import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile, Role } from "@/lib/types";

/** The signed-in user's profile, or null (signed out, no profile, or deactivated). */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, login_id, full_name, role, active, created_at")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!data || !data.active) return null;
  return data as Profile;
}

/** Page guard: sends signed-out users to /login and wrong-role users to their home. */
export async function requireProfile(allowed?: Role[]): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login?reason=signed_out");
  if (allowed && !allowed.includes(profile.role)) redirect("/");
  return profile;
}

export const homeFor = (role: Role) => (role === "caller" ? "/queue" : "/dashboard");
