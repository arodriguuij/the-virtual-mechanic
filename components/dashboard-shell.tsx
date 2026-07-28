"use client";

import { BarChart3, History, LayoutDashboard, LogOut, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { AppLogo } from "@/components/app-logo";
import { logout } from "@/lib/auth-actions";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/estadisticas", label: "Estadísticas", icon: BarChart3 },
  { href: "/historial", label: "Historial", icon: History },
  { href: "/perfil", label: "Perfil fisiológico", icon: UserRound },
];

function SidebarContent({
  onNavigate,
  onClose,
  identitySlot,
}: {
  onNavigate?: () => void;
  onClose?: () => void;
  identitySlot: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col px-6 py-8">
      <div className="mb-6 flex w-full items-center justify-between border-b border-neutral-200/80 pb-4">
        <Link
          href="/"
          onClick={onNavigate}
          aria-label="Ir al Dashboard"
          className="flex cursor-pointer items-center gap-2 text-xs font-bold tracking-wider whitespace-nowrap text-neutral-900 uppercase transition-opacity duration-150 hover:opacity-80 focus:outline-none"
        >
          <AppLogo className="size-6 shrink-0" />
          Motor Metabólico
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar menú"
          className="cursor-pointer rounded-lg p-2 text-neutral-400 transition-all duration-150 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none lg:hidden"
        >
          <X className="size-5" />
        </button>
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
                "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-xs tracking-wider uppercase transition-colors duration-150",
                active
                  ? "bg-surface font-semibold text-terracotta"
                  : "font-medium text-neutral-600 hover:bg-neutral-100/60 hover:text-neutral-900"
              )}
            >
              <item.icon className="size-4" strokeWidth={1.5} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 flex w-full flex-col border-t border-neutral-200/80 pt-4">
        {identitySlot}

        <div className="mt-4 border-t border-neutral-200/80 pt-3">
          <form action={logout}>
            <button
              type="submit"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 font-mono text-xs font-semibold tracking-wider text-neutral-500 uppercase transition-all duration-150 hover:bg-red-50/80 hover:text-red-600"
            >
              <LogOut className="size-3.5" strokeWidth={1.5} />
              Cerrar sesión
            </button>
          </form>
        </div>
      </div>

      <div className="mt-4 pt-3 text-center font-mono text-[10px] tracking-widest text-neutral-400 uppercase">
        Motor Metabólico v1.0 · Nutrición de precisión
      </div>
    </div>
  );
}

export function DashboardShell({
  children,
  identitySlot,
}: {
  children: ReactNode;
  identitySlot: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <div
        className={cn(
          "fixed inset-0 z-9999 bg-black/30 transition-opacity lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileOpen(false)}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-10000 w-64 border-r border-neutral-200 bg-background transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent
          onNavigate={() => setMobileOpen(false)}
          onClose={() => setMobileOpen(false)}
          identitySlot={identitySlot}
        />
      </aside>

      <div className="flex flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-40 flex w-full items-center justify-center border-b border-neutral-200/80 bg-white/90 px-6 py-4 backdrop-blur-md transition-all lg:hidden">
          <button
            type="button"
            className="absolute left-6 cursor-pointer text-neutral-500 transition-colors duration-150 hover:text-neutral-900"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <Link
            href="/"
            aria-label="Ir al Dashboard"
            className="flex cursor-pointer items-center gap-2 text-xs font-bold whitespace-nowrap text-neutral-900 uppercase tracking-wider transition-opacity duration-150 hover:opacity-80 focus:outline-none"
          >
            <AppLogo className="size-6 shrink-0" />
            Motor Metabólico
          </Link>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10 sm:px-8 sm:py-14">
          {children}
        </main>
      </div>
    </div>
  );
}
