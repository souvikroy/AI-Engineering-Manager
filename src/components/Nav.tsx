"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Dashboard" },
  { href: "/chat", label: "Chat" },
  { href: "/decisions", label: "Decisions" },
  { href: "/people", label: "People" },
  { href: "/execution", label: "Execution" },
  { href: "/incidents", label: "Incidents" },
  { href: "/reviews", label: "PR Reviews" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 px-6 py-3 border-b border-border bg-surface sticky top-0 z-10">
      <div className="text-sm font-semibold tracking-wide text-accent mr-6">AI EM Copilot</div>
      {items.map((item) => {
        const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 rounded text-sm transition ${
              active ? "bg-accent text-white" : "text-muted hover:text-white hover:bg-border"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      <div className="flex-1" />
      <span className="text-xs text-muted">CEO view · Q2 2026</span>
    </nav>
  );
}
