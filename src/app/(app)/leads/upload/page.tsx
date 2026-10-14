import type { Metadata } from "next";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CallerRef } from "@/lib/upload/assignee";
import { UploadClient } from "./upload-client";

export const metadata: Metadata = { title: "Upload leads" };

export default async function UploadPage() {
  await requireProfile(["admin", "manager"]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles").select("id, full_name, login_id").eq("role", "caller").eq("active", true);

  return (
    <div className="space-y-5">
      <header>
        <Link href="/leads" className="text-sm text-muted underline">← Leads</Link>
        <h1 className="mt-1 text-xl font-bold">Upload leads</h1>
        <p className="text-sm text-muted">
          Excel (.xlsx, .xls) or CSV, or paste rows. We check everything first and show you a preview before anything is saved.
        </p>
      </header>
      <UploadClient callers={(data ?? []) as CallerRef[]} />
    </div>
  );
}
