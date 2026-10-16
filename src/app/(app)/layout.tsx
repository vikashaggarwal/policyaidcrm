import Image from "next/image";
import { requireProfile } from "@/lib/auth";
import { signOut } from "./actions";
import { NavLinks } from "./nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();

  const links =
    profile.role === "caller"
      ? [{ href: "/queue", label: "Queue" }]
      : [
          { href: "/dashboard", label: "Dashboard" },
          { href: "/leads", label: "Leads" },
          { href: "/audit", label: "Audit" },
          ...(profile.role === "admin" ? [{ href: "/admin/users", label: "Users" }] : []),
        ];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-3">
          <span className="flex shrink-0 items-center gap-2 font-bold">
            <Image src="/brand/policyaid-logo-256.png" alt="" width={32} height={32} className="size-8" />
            PolicyAid CRM
          </span>
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-sm text-muted">{profile.full_name}</span>
            <form action={signOut}>
              <button type="submit" className="btn !min-h-10 !px-3 text-sm">Sign out</button>
            </form>
          </div>
        </div>
        <NavLinks links={links} />
      </header>
      <main id="main" tabIndex={-1} className="flex-1 px-4 py-5 outline-none">{children}</main>
    </div>
  );
}
