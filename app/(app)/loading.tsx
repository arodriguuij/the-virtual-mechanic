import { Skeleton } from "@/components/ui/skeleton";

/**
 * `loading.tsx` scoped to the `(app)` route group — Next only wraps this
 * segment's `{children}` (i.e. whatever `app/(app)/layout.tsx` passes into
 * `DashboardShell`'s `<main>`) in this Suspense fallback, never the layout
 * itself, so the header/sidebar stay mounted and visible while it shows.
 *
 * A generic content-shaped skeleton (header bar / selector bar / metric grid
 * / content block), not the breathing brand mark the root `app/loading.tsx`
 * still uses — that mark reads fine for a one-time app-wide boot, but firing
 * on every single cross-page navigation between Dashboard routes (these are
 * all `force-dynamic`, so this fallback genuinely does fire on every nav)
 * read as a jarring "different loading card" rather than "the same UI,
 * filling in." No `p-4`/`p-6` of its own: `DashboardShell`'s `<main>` already
 * supplies the page's outer padding, and every real page's content sits
 * directly inside that with no second padding layer — adding one here would
 * make this fallback sit inset differently than the real content it's
 * standing in for.
 */
export default function AppLoading() {
  return (
    <div className="w-full flex-1 space-y-6">
      <Skeleton className="h-8 w-48 rounded-md" />
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="grid grid-cols-1 gap-4 py-2 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
