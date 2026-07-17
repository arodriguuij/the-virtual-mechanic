"use client";

import {
  Activity,
  Bike,
  Cog,
  LayoutDashboard,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", icon: LayoutDashboard, current: true },
  { name: "Mis bicicletas", icon: Bike, current: false },
  { name: "Componentes", icon: Cog, current: false },
  { name: "Actividad", icon: Activity, current: false },
  { name: "Ajustes", icon: Settings, current: false },
];

function SidebarContent() {
  return (
    <div className="flex h-full flex-col gap-10 px-6 py-8">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-neutral-900 uppercase">
        <Bike className="size-4" strokeWidth={1.5} />
        The Virtual Mechanic
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {navigation.map((item) => (
          <a
            key={item.name}
            href="#"
            className={cn(
              "flex items-center gap-3 border-l-2 px-3 py-2.5 text-[11px] font-medium tracking-widest uppercase transition-colors",
              item.current
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-900"
            )}
          >
            <item.icon className="size-4" strokeWidth={1.5} />
            {item.name}
          </a>
        ))}
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
            Scott Addict 30
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
          className="absolute top-7 right-4 text-neutral-500 lg:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <X className="size-5" />
        </button>
        <SidebarContent />
      </aside>

      <div className="flex flex-1 flex-col lg:pl-64">
        <header className="flex items-center gap-4 border-b border-neutral-200 px-6 py-4 lg:hidden">
          <button
            type="button"
            className="text-neutral-500"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <span className="text-xs font-semibold tracking-[0.2em] text-neutral-900 uppercase">
            The Virtual Mechanic
          </span>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10 sm:px-8 sm:py-14">
          {children}
        </main>
      </div>
    </div>
  );
}
