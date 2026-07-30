import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { SyncForm } from "@/components/sync-button";
import { getViewerIdentity } from "@/lib/dashboard-data";

/** Sidebar identity card, streamed in separately (see `ViewerIdentitySkeleton`
 * below) since it's the one part of the sidebar that needs a Strava round-
 * trip — everything else in `DashboardShell` renders instantly. The
 * "Sincronizar" action (`SyncForm`, `components/sync-button.tsx`) moved here
 * from the Dashboard header — it's a routine, secondary utility action, so
 * it reads better sitting quietly next to "Conectado con Strava" than
 * competing for space next to the greeting. Only rendered when actually
 * connected — an athlete who somehow isn't (unreachable in practice, since
 * Strava OAuth is this app's only login mechanism) has nothing to sync. */
export async function ViewerIdentity() {
  const identity = await getViewerIdentity();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
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
      {identity.isStravaConnected && <SyncForm />}
    </div>
  );
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
