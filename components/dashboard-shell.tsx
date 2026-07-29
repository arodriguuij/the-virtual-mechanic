"use client";

import { BarChart3, History, LayoutDashboard, LogOut, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { RatioLogo } from "@/components/icons/RatioLogo";
import { logout } from "@/lib/auth-actions";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/estadisticas", label: "Estadísticas", icon: BarChart3 },
  { href: "/historial", label: "Historial", icon: History },
  { href: "/perfil", label: "Perfil fisiológico", icon: UserRound },
];

/**
 * Clicking the brand mark while already on the Dashboard shouldn't navigate at
 * all (a same-page `Link` click is a no-op route change anyway) — instead it
 * scrolls smoothly back to the top, the same "logo always gets you home, and
 * home is where you already are" affordance most editorial sites use. Anywhere
 * else, falls through to the `Link`'s normal navigation to `/`.
 */
function scrollToTopIfHome(e: React.MouseEvent<HTMLAnchorElement>, pathname: string) {
  if (pathname === "/") {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function SidebarContent({
  onNavigate,
  onClose,
  identitySlot,
  isLoggingOut,
  onLogoutStart,
}: {
  onNavigate?: () => void;
  onClose?: () => void;
  identitySlot: ReactNode;
  isLoggingOut: boolean;
  onLogoutStart: () => void;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col px-6 py-8">
      <div className="mb-6 flex w-full items-center justify-between border-b border-neutral-200/80 pb-4">
        <Link
          href="/"
          onClick={(e) => {
            onNavigate?.();
            scrollToTopIfHome(e, pathname);
          }}
          aria-label="Ir al Dashboard"
          className="flex cursor-pointer items-center gap-2 text-xs font-bold tracking-wider whitespace-nowrap text-neutral-900 uppercase transition-opacity duration-150 hover:opacity-80 focus:outline-none"
        >
          <RatioLogo className="size-6 shrink-0 text-terracotta" />
          RATIO
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
          {/* `onSubmit` fires synchronously the instant the button is
              clicked — well before `logout()` (the real Server Action,
              which calls `supabase.auth.signOut()` then `redirect("/login")`
              server-side) ever resolves — so `isLoggingOut` flips true
              immediately for the spinner/disabled state below and the
              full-page dim in `DashboardShell`. No separate client-side
              `supabase.auth.signOut()` call is needed: the existing action
              already performs the real sign-out and its own `redirect()` is
              already the "clean redirect to /login" — duplicating that
              client-side would just race the same work twice. The action
              itself unmounts this component via navigation, so there's no
              matching `setIsLoggingOut(false)` to write. */}
          <form action={logout} onSubmit={onLogoutStart}>
            <button
              type="submit"
              disabled={isLoggingOut}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 font-mono text-xs font-semibold tracking-wider uppercase transition-all duration-150",
                isLoggingOut
                  ? "cursor-wait text-neutral-500 opacity-70"
                  : "cursor-pointer text-neutral-500 hover:bg-red-50/80 hover:text-red-600"
              )}
            >
              {isLoggingOut ? (
                <span
                  className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
              ) : (
                <LogOut className="size-3.5 shrink-0" strokeWidth={1.5} />
              )}
              {isLoggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
            </button>
          </form>
        </div>
      </div>

      <div className="mt-4 pt-3 text-center font-mono text-[10px] tracking-widest text-neutral-400 uppercase">
        RATIO v1.0 · Nutrición de precisión
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
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  return (
    <div
      className={cn(
        "min-h-screen bg-background transition-opacity duration-300",
        isLoggingOut && "pointer-events-none opacity-80"
      )}
    >
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
          isLoggingOut={isLoggingOut}
          onLogoutStart={() => setIsLoggingOut(true)}
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
            onClick={(e) => scrollToTopIfHome(e, pathname)}
            aria-label="Ir al Dashboard"
            className="flex cursor-pointer items-center gap-2 text-xs font-bold whitespace-nowrap text-neutral-900 uppercase tracking-wider transition-opacity duration-150 hover:opacity-80 focus:outline-none"
          >
            <RatioLogo className="size-6 shrink-0 text-terracotta" />
            RATIO
          </Link>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-10 pb-12 sm:px-8 sm:pt-14 sm:pb-16">
          {children}
        </main>
      </div>
    </div>
  );
}
