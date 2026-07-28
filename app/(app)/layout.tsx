import { Suspense } from "react";

import { DashboardShell } from "@/components/dashboard-shell";
import { ViewerIdentity, ViewerIdentitySkeleton } from "@/components/viewer-identity";

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
 */
export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell
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
