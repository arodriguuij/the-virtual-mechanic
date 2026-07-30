import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard-shell";
import { ViewerIdentity, ViewerIdentitySkeleton } from "@/components/viewer-identity";
import { getAthleteProfile, isProfileComplete } from "@/lib/dashboard-data";

/**
 * Shared layout for every authenticated Dashboard-shell route (`/`,
 * `/perfil`, `/estadisticas`, `/historial` — grouped here via the `(app)`
 * route group, which doesn't affect any of their URLs). `DashboardShell`
 * (header + sidebar) used to be rendered separately inside each page's own
 * component, which meant Next's nearest `loading.tsx` — a Suspense fallback
 * around a segment's `{children}` — replaced the *entire* page, shell
 * included, while that page's data was resolving: the header/sidebar would
 * flicker out and back in on every navigation. Hoisting `DashboardShell`
 * into this layout instead means it renders once, immediately, independent
 * of any page's own data fetching — only `{children}` (rendered inside
 * `DashboardShell`'s own `<main>`) falls inside `app/(app)/loading.tsx`'s
 * Suspense boundary now, so the shell itself never disappears.
 *
 * Also resolves `isProfileComplete` for the Sidebar's own link-disabling
 * (see `components/dashboard-shell.tsx`) — `proxy.ts`'s Edge Middleware
 * already redirects an incomplete profile away from every route except
 * `/perfil`, so in practice this can only ever be `false` while actually
 * rendering `/perfil` itself; this layout has no access to the current
 * pathname (Server Component layouts aren't given one), so it computes the
 * same boolean unconditionally rather than trying to guess which route
 * triggered the render. `getAthleteProfile()` is `cache()`-deduped, so this
 * costs no extra query on `/perfil` (which already calls it for the form
 * itself) and is the only query this adds on the other three routes.
 */
export default async function AppShellLayout({ children }: { children: React.ReactNode }) {
  const profile = await getAthleteProfile();

  return (
    <DashboardShell
      isProfileComplete={isProfileComplete(profile)}
      identitySlot={
        <Suspense fallback={<ViewerIdentitySkeleton />}>
          <ViewerIdentity />
        </Suspense>
      }
    >
      {children}
    </DashboardShell>
  );
}
