"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { LOGIN_ID_PATTERN, loginIdToEmail, normaliseLoginId } from "@/lib/config";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: boolean; message: string };

const fail = (message: string): ActionResult => ({ ok: false, message });
const ok = (message: string): ActionResult => ({ ok: true, message });

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be 72 characters or fewer.");

const createSchema = z.object({
  loginId: z
    .string()
    .transform(normaliseLoginId)
    .refine((v) => LOGIN_ID_PATTERN.test(v), "Login ID must be 3–32 characters: letters, numbers, dot, dash or underscore."),
  fullName: z.string().trim().min(2, "Enter the person's full name.").max(80, "Name is too long."),
  role: z.enum(["admin", "manager", "caller"], "Choose a role."),
  password: passwordSchema,
});

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Please check the details and try again.";

async function audit(actorId: string, action: string, entityId: string, details: Record<string, unknown>) {
  await createAdminClient()
    .from("audit_log")
    .insert({ actor_id: actorId, action, entity: "profile", entity_id: entityId, details });
}

export async function createUser(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireProfile(["admin"]);
  const parsed = createSchema.safeParse({
    loginId: formData.get("loginId") ?? "",
    fullName: formData.get("fullName") ?? "",
    role: formData.get("role") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { loginId, fullName, role, password } = parsed.data;

  const sb = createAdminClient();
  const { data: created, error } = await sb.auth.admin.createUser({
    email: loginIdToEmail(loginId),
    password,
    email_confirm: true,
  });
  if (error || !created.user) {
    const taken = error?.message?.toLowerCase().includes("already");
    return fail(
      taken
        ? `The login ID "${loginId}" is already in use. Choose a different one.`
        : "We couldn't create that user. Check your connection and try again.",
    );
  }

  const { error: profileError } = await sb
    .from("profiles")
    .insert({ id: created.user.id, login_id: loginId, full_name: fullName, role, active: true });
  if (profileError) {
    await sb.auth.admin.deleteUser(created.user.id); // leave nothing half-made
    return fail("We couldn't finish creating that user, so nothing was saved. Please try again.");
  }

  await audit(admin.id, "user_create", created.user.id, { login_id: loginId, role });
  revalidatePath("/admin/users");
  return ok(`Created ${fullName} (${loginId}). Share the password with them securely.`);
}

export async function resetPassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireProfile(["admin"]);
  const userId = z.uuid().safeParse(formData.get("userId"));
  const password = passwordSchema.safeParse(formData.get("password") ?? "");
  if (!userId.success) return fail("That user could not be found.");
  if (!password.success) return fail(firstIssue(password.error));

  const { error } = await createAdminClient().auth.admin.updateUserById(userId.data, { password: password.data });
  if (error) return fail("We couldn't change that password. Please try again.");
  await audit(admin.id, "user_reset_password", userId.data, {});
  return ok("Password changed. Share it with them securely.");
}

export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const admin = await requireProfile(["admin"]);
  if (!z.uuid().safeParse(userId).success) return fail("That user could not be found.");
  if (userId === admin.id) return fail("You can't switch off your own account.");

  const sb = createAdminClient();
  const { error } = await sb.from("profiles").update({ active }).eq("id", userId);
  if (error) return fail("We couldn't update that user. Please try again.");
  // Also ban or unban at the auth layer so existing sessions stop working.
  await sb.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });
  await audit(admin.id, active ? "user_activate" : "user_deactivate", userId, {});
  revalidatePath("/admin/users");
  return ok(active ? "User switched on." : "User switched off. They are signed out.");
}

export async function setUserRole(userId: string, role: string): Promise<ActionResult> {
  const admin = await requireProfile(["admin"]);
  const parsedRole = z.enum(["admin", "manager", "caller"]).safeParse(role);
  if (!z.uuid().safeParse(userId).success || !parsedRole.success) return fail("That change isn't valid.");
  if (userId === admin.id) return fail("You can't change your own role. Ask another admin.");

  const { error } = await createAdminClient().from("profiles").update({ role: parsedRole.data }).eq("id", userId);
  if (error) return fail("We couldn't change that role. Please try again.");
  await audit(admin.id, "user_role_change", userId, { role: parsedRole.data });
  revalidatePath("/admin/users");
  return ok("Role updated.");
}
