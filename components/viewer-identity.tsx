import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { getViewerIdentity } from "@/lib/dashboard-data";

/** Sidebar identity card, streamed in separately (see `ViewerIdentitySkeleton`
 * below) since it's the one part of the sidebar that needs a Strava round-
 * trip — everything else in `DashboardShell` renders instantly. */
export async function ViewerIdentity() {
  const identity = await getViewerIdentity();

  return (
    <div className="flex items-center gap-3 border-t border-neutral-200 pt-6">
      <Avatar>
        {identity.avatarUrl && <AvatarImage src={identity.avatarUrl} alt={identity.name} />}
        <AvatarFallback>{identity.initials}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col overflow-hidden">
        <span className="truncate text-sm font-medium text-neutral-900">{identity.name}</span>
        <span className="flex items-center truncate text-[10px] tracking-widest text-neutral-500 uppercase">
          {identity.isStravaConnected && (
            <span className="mr-1.5 inline-block size-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
          )}
          {identity.subtitle}
        </span>
      </div>
    </div>
  );
}

export function ViewerIdentitySkeleton() {
  return (
    <div className="flex items-center gap-3 border-t border-neutral-200 pt-6">
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  );
}
