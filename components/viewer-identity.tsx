import { Skeleton } from "@/components/ui/skeleton";
import { SidebarIdentityCard } from "@/components/sidebar-identity-card";
import { getViewerIdentity } from "@/lib/dashboard-data";

/** Sidebar identity card, streamed in separately (see `ViewerIdentitySkeleton`
 * below) since it's the one part of the sidebar that needs a Strava round-
 * trip — everything else in `DashboardShell` renders instantly. The actual
 * presentation (full detail vs. the collapsed-sidebar avatar-only view) lives
 * in `SidebarIdentityCard` (`components/sidebar-identity-card.tsx`, a "use
 * client" component reading `isCollapsed` off `SidebarCollapseContext`) —
 * this stays a plain async Server Component whose only job is the real
 * Strava-backed data fetch. */
export async function ViewerIdentity() {
  const identity = await getViewerIdentity();
  return <SidebarIdentityCard identity={identity} />;
}

export function ViewerIdentitySkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  );
}
