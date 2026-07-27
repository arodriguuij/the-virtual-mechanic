"use client";

import { Flame, LayoutDashboard, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/perfil", label: "Perfil fisiológico", icon: UserRound },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col gap-10 px-6 py-8">
      <div className="flex items-center gap-2 border-b border-neutral-200 pb-6 text-xs font-bold tracking-[0.2em] text-neutral-900 uppercase">
        <Flame className="size-4" strokeWidth={1.5} />
        Motor Metabólico
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex cursor-pointer items-center gap-3 border-l-2 px-3 py-2.5 text-[11px] font-semibold tracking-widest uppercase transition-colors duration-150",
                active
                  ? "border-neutral-900 text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              )}
            >
              <item.icon className="size-4" strokeWidth={1.5} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-3 border-t border-neutral-200 pt-6">
        <Avatar>
          <AvatarFallback>AR</AvatarFallback>
        </Avatar>
        <div className="flex flex-col overflow-hidden">
          <span className="truncate text-sm font-medium text-neutral-900">
            Alejandro Rodríguez
          </span>
          <span className="truncate text-[10px] tracking-widest text-neutral-500 uppercase">
            Ciclista de resistencia
          </span>
        </div>
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/30 transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileOpen(false)}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-neutral-200 bg-background transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <button
          type="button"
          className="absolute top-7 right-4 cursor-pointer text-neutral-500 transition-colors duration-150 hover:text-neutral-900 lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <X className="size-5" />
        </button>
        <SidebarContent onNavigate={() => setMobileOpen(false)} />
      </aside>

      <div className="flex flex-1 flex-col lg:pl-64">
        <header className="flex items-center gap-4 border-b border-neutral-200 px-6 py-4 lg:hidden">
          <button
            type="button"
            className="cursor-pointer text-neutral-500 transition-colors duration-150 hover:text-neutral-900"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <span className="text-xs font-bold tracking-[0.2em] text-neutral-900 uppercase">
            Motor Metabólico
          </span>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10 sm:px-8 sm:py-14">
          {children}
        </main>
      </div>
    </div>
  );
}
