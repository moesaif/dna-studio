"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings/providers", label: "Providers" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/account", label: "Account" },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="w-40 shrink-0 space-y-1">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "block rounded-lg px-3 py-2 text-sm transition-colors",
            pathname === tab.href
              ? "bg-card text-foreground"
              : "text-muted hover:text-foreground hover:bg-card/60"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
