"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ links }: { links: { href: string; label: string }[] }) {
  const pathname = usePathname();
  if (links.length < 2) return null;
  return (
    <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto pb-2 pt-1">
      {links.map((l) => {
        const current = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href} href={l.href} aria-current={current ? "page" : undefined}
            className={`flex min-h-11 items-center rounded-lg px-4 text-sm font-medium ${
              current ? "bg-white text-primary" : "text-primary-ink hover:bg-white/15"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
