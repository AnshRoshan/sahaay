"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

const GROUPS: { label: string; items: { href: string; label: string; icon: string }[] }[] = [
  { label: "Overview", items: [{ href: "/", label: "What needs attention", icon: "◉" }, { href: "/decisions", label: "Decisions", icon: "✓" }] },
  { label: "Operations", items: [{ href: "/import", label: "Import data", icon: "⇪" }, { href: "/capture", label: "Capture", icon: "🎙" }, { href: "/inventory", label: "Inventory", icon: "▤" }, { href: "/ledger", label: "Event ledger", icon: "⛓" }, { href: "/suppliers", label: "Suppliers", icon: "⛟" }] },
  { label: "Intelligence", items: [{ href: "/forecasts", label: "Forecasts", icon: "↗" }] },
  { label: "Memory", items: [{ href: "/history", label: "Decision history", icon: "⟲" }] },
  { label: "Automation", items: [{ href: "/workflows", label: "Workflows", icon: "⏱" }] },
  { label: "Assistant", items: [{ href: "/ask", label: "Ask Sahaay", icon: "✦" }] },
  { label: "System", items: [{ href: "/settings", label: "Rules & settings", icon: "⚙" }, { href: "/system", label: "Architecture & traces", icon: "⌘" }] },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 py-2 md:block md:space-y-5 md:overflow-visible md:px-3 md:py-4">
      {GROUPS.map((g) => (
        <div key={g.label} className="flex gap-1 md:block">
          <div className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 md:block">{g.label}</div>
          {g.items.map((i) => {
            const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition",
                  active ? "bg-indigo-50 font-semibold text-indigo-700" : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <span className="w-4 text-center text-base opacity-80">{i.icon}</span>
                {i.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
