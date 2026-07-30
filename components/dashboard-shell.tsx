"use client";

import { BarChart3, History, LayoutDashboard, LogOut, Menu, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { RatioLogo } from "@/components/icons/RatioLogo";
import { logout } from "@/lib/auth-actions";
import { cn } from "@/lib/utils";

// Estadísticas/Historial are mid-rebuild and permanently disabled in the nav
// for now — the routes/pages themselves are untouched, only their sidebar
// entries stop being clickable, so re-enabling one later is just flipping
// `permanentlyDisabled` back to `false`. This is a separate reason for being
// locked from the profile-completeness lock below (`/` can be locked too,
// but only conditionally, never permanently) — the two are handled together
// at render time but kept as distinct flags here so neither can be confused
// for the other.
const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permanentlyDisabled: false },
  { href: "/perfil", label: "Perfil fisiológico", icon: UserRound, permanentlyDisabled: false },
  { href: "/estadisticas", label: "Estadísticas", icon: BarChart3, permanentlyDisabled: true },
  { href: "/historial", label: "Historial", icon: History, permanentlyDisabled: true },
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
  isProfileComplete,
}: {
  onNavigate?: () => void;
  onClose?: () => void;
  identitySlot: ReactNode;
  isLoggingOut: boolean;
  onLogoutStart: () => void;
  isProfileComplete: boolean;
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
          // Two independent reasons an entry can be locked: permanently (an
          // in-development section) or conditionally (every route but
          // `/perfil` itself, while the athlete's Physiological Profile is
          // still incomplete — see `app/(app)/layout.tsx` and `proxy.ts`'s
          // Edge Middleware redirect, which is the actual enforcement; this
          // is just the matching visual affordance so a locked-out athlete
          // never taps a link that immediately bounces them back). Perfil
          // itself is never locked by the second reason — it's the one
          // place an incomplete profile is allowed to be.
          const lockedByIncompleteProfile = item.href !== "/perfil" && !isProfileComplete;
          const locked = item.permanentlyDisabled || lockedByIncompleteProfile;

          if (locked) {
            return (
              <div
                key={item.href}
                aria-disabled="true"
                title={
                  item.permanentlyDisabled
                    ? "Sección en desarrollo — Próximamente"
                    : "Completa tu perfil fisiológico para desbloquear esta sección"
                }
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-xs font-medium tracking-wider text-neutral-600 uppercase opacity-50 select-none"
              >
                {/* Every entry renders its own icon now, locked or not — the
                    wrapping div's own `opacity-50` already dims the icon
                    (and the badge) right along with the label, so a locked
                    entry's icon reads as visibly muted without needing its
                    own separate opacity class. An earlier pass replaced this
                    with a blank spacer to avoid Historial/Estadísticas
                    looking visually inconsistent with each other — restored
                    once both render through this exact same `<item.icon>`
                    unconditionally, so that inconsistency can't recur. */}
                <item.icon className="size-4 shrink-0" strokeWidth={1.5} />
                {item.label}
                {item.permanentlyDisabled && (
                  <span className="ml-auto shrink-0 rounded bg-neutral-200/60 px-1.5 py-0.5 font-mono text-[9px] tracking-wider whitespace-nowrap text-neutral-500 uppercase">
                    Próx.
                  </span>
                )}
              </div>
            );
          }

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
          {/* Deliberately no red/orange/destructive treatment on hover — logging
              out isn't a destructive action in the "irreversible, data-loss" sense
              a red hover usually signals, and it broke this app's own PNS
              palette. Hovering now shades toward the app's own `--terracotta`
              tint (`hover:bg-terracotta/10`) with the same near-black
              `hover:text-neutral-900` every other neutral-to-active row transition
              in this sidebar uses, not a color unique to this one button. */}
          <form action={logout} onSubmit={onLogoutStart}>
            <button
              type="submit"
              disabled={isLoggingOut}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors duration-150",
                isLoggingOut
                  ? "cursor-wait text-neutral-500 opacity-70"
                  : "cursor-pointer text-neutral-500 hover:bg-terracotta/10 hover:text-neutral-900"
              )}
            >
              {isLoggingOut ? (
                <span
                  className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
              ) : (
                <LogOut className="size-4 shrink-0 text-current" strokeWidth={1.5} />
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
  isProfileComplete,
}: {
  children: ReactNode;
  identitySlot: ReactNode;
  isProfileComplete: boolean;
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

      {/* Mobile: anchored to the right edge, sliding in from
          `translate-x-full` (off-screen right) to `translate-x-0` — a
          right-hand hamburger button (below) opening a right-hand drawer is
          the more familiar mobile-nav convention than the left/left pairing
          this used to be. Desktop (`lg:`) is untouched: the same element is
          also the permanent left sidebar there, so every mobile-only class
          above has an `lg:` override putting it back on the left, borderless
          side flipped to `border-r`, and always visible regardless of
          `mobileOpen`. */}
      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-10000 w-[85vw] max-w-[320px] border-l border-neutral-200 bg-background transition-transform lg:right-auto lg:left-0 lg:w-64 lg:translate-x-0 lg:border-l-0 lg:border-r",
          mobileOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <SidebarContent
          onNavigate={() => setMobileOpen(false)}
          onClose={() => setMobileOpen(false)}
          identitySlot={identitySlot}
          isLoggingOut={isLoggingOut}
          onLogoutStart={() => setIsLoggingOut(true)}
          isProfileComplete={isProfileComplete}
        />
      </aside>

      <div className="flex flex-1 flex-col lg:pl-64">
        {/* Porcelain-on-porcelain, PNS-style: no `border-b` — the header
            used to carry a hard `border-neutral-200/80` rule plus an opaque
            `bg-white/90`, both of which stood out as a visibly different
            surface from the `bg-background` canvas beneath it once scrolled
            content passed underneath. Now `bg-background/80` (the same
            porcelain token, not a literal white) blends into the page it's
            floating over, and a soft diffuse shadow — not a line — is what
            separates it from scrolled content instead, matching how iOS
            Safari's own status bar reads as one continuous surface with the
            page color beneath it (see `viewport.themeColor` in
            `app/layout.tsx`, set to this same tone). The shadow itself was
            intensified from an earlier, barely-perceptible
            `shadow-[0_2px_12px_rgba(0,0,0,0.03)]` to a more pronounced,
            wider-spread `shadow-[0_4px_20px_rgba(0,0,0,0.06)]` — matching
            Pas Normal Studios' own floating-header depth, where the bar
            clearly reads as lifted above the scrolled content rather than
            merely tinted. Horizontal padding matches `<main>`'s own
            `px-4 sm:px-6` below, so the brand mark's left edge and the
            hamburger's right edge line up with the card edges in the
            content underneath instead of sitting inset from them. */}
        <header className="sticky top-0 z-40 flex w-full items-center justify-center bg-background/80 px-4 py-4 shadow-[0_4px_20px_rgba(0,0,0,0.06)] backdrop-blur-md transition-all sm:px-6 lg:hidden">
          <Link
            href="/"
            onClick={(e) => scrollToTopIfHome(e, pathname)}
            aria-label="Ir al Dashboard"
            className="flex cursor-pointer items-center gap-2 text-xs font-bold whitespace-nowrap text-neutral-900 uppercase tracking-wider transition-opacity duration-150 hover:opacity-80 focus:outline-none"
          >
            <RatioLogo className="size-6 shrink-0 text-terracotta" />
            RATIO
          </Link>
          <button
            type="button"
            className="absolute right-4 cursor-pointer text-neutral-500 transition-colors duration-150 hover:text-neutral-900 sm:right-6"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="size-5" />
          </button>
        </header>

        {/* Mobile lateral padding tightened from `px-6` (24px) to `px-4`
            (16px) — a PNS-editorial pass asked for the page's own content to
            sit closer to the viewport edge on a phone, matching this app's
            existing `sm:`/`md:` step-up convention rather than a flat value
            at every breakpoint. */}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-10 pb-12 sm:px-6 sm:pt-14 sm:pb-16 md:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
