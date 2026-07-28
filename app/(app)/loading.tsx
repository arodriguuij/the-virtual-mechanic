import { AppLogo } from "@/components/app-logo";

/**
 * `loading.tsx` scoped to the `(app)` route group — Next only wraps this
 * segment's `{children}` (i.e. whatever `app/(app)/layout.tsx` passes into
 * `DashboardShell`'s `<main>`) in this Suspense fallback, never the layout
 * itself, so the header/sidebar stay mounted and visible while it shows.
 * `flex-1 min-h-[60vh]` (not `min-h-screen`/`fixed inset-0`) keeps this
 * contained to the content area rather than covering the shell; no
 * background color of its own, so it blends into `DashboardShell`'s
 * `bg-background` instead of painting a visible box mid-page.
 */
export default function AppLoading() {
  return (
    <div className="flex min-h-[60vh] w-full flex-1 items-center justify-center py-12">
      <AppLogo className="animate-logo-breathe size-12" />
    </div>
  );
}
