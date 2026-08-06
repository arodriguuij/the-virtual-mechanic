"use client";

import { useContext } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SyncForm } from "@/components/sync-button";
import { SidebarCollapseContext } from "@/components/dashboard-shell";
import type { ViewerIdentity } from "@/lib/dashboard-data";

/**
 * The sidebar identity card's actual presentation — split out of
 * `ViewerIdentity` (`components/viewer-identity.tsx`, an async Server
 * Component fetching the real Strava-backed identity) into its own "use
 * client" module specifically so it can read `isCollapsed` off
 * `SidebarCollapseContext` (`components/dashboard-shell.tsx`). That context
 * is genuinely client-only state (persisted to `localStorage`, toggled by a
 * button), but `identitySlot` itself is constructed by the page (a Server
 * Component) and passed down as an already-built `ReactNode` — a Context
 * Provider wrapping that `ReactNode` still resolves correctly for any client
 * component inside it, since React resolves context by the element's
 * position in the rendered tree, not by which module created the element.
 * This is the one piece of the sidebar that needs that indirection; every
 * other collapsed/expanded difference (the logo, nav items) lives entirely
 * inside `dashboard-shell.tsx` itself, where `isCollapsed` is already an
 * ordinary prop.
 */
export function SidebarIdentityCard({ identity }: { identity: ViewerIdentity }) {
  const isCollapsed = useContext(SidebarCollapseContext);

  if (isCollapsed) {
    return (
      <div className="flex justify-center" title={identity.name}>
        <div className="relative">
          <Avatar className="size-8">
            {identity.avatarUrl && <AvatarImage src={identity.avatarUrl} alt={identity.name} />}
            <AvatarFallback>{identity.initials}</AvatarFallback>
          </Avatar>
          {identity.isStravaConnected && (
            <span
              className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500"
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    );
  }

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
