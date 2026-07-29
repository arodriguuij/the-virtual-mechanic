import { Link2 } from "lucide-react";
import NextLink from "next/link";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FuelingPlanner } from "@/components/fueling-planner";
import { PostRideAnalysis } from "@/components/post-ride-analysis";
import { ProfileCheckBanner } from "@/components/profile-check-banner";
import { SyncForm } from "@/components/sync-button";
import {
  getAthleteAverageSpeedKmh,
  getAthleteProfile,
  getMissingProfileFields,
  getProfile,
  getRecentActivities,
  getStravaRoutes,
  getViewerIdentity,
} from "@/lib/dashboard-data";
import { primaryButtonClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const eyebrow = "text-[10px] font-semibold tracking-widest text-neutral-600 uppercase";
const greetingClass =
  "truncate font-mono text-[10px] tracking-wider text-neutral-500 uppercase sm:text-xs";

function getGreetingPrefix(hour: number): string {
  if (hour >= 5 && hour < 12) return "Buenos días";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

// Its own Suspense boundary (like `StravaButton`/`ProfileCheckBannerSection`
// below) so the greeting's Strava round-trip via `getViewerIdentity()` never
// blocks the rest of the Dashboard from rendering — `getViewerIdentity` is
// `cache()`-deduped, so this costs no extra query beyond what the sidebar's
// own `ViewerIdentity` already fetches this request.
async function GreetingSection() {
  const identity = await getViewerIdentity();
  const firstName = identity.name.split(" ")[0];
  const greeting = getGreetingPrefix(new Date().getHours());
  return (
    <p className={greetingClass}>
      {greeting}, {firstName}
    </p>
  );
}

function GreetingSkeleton() {
  return <Skeleton className="h-3 w-28" />;
}

async function FuelingPlannerSection() {
  const profile = await getAthleteProfile();

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Planificador de nutrición</CardTitle>
          <CardDescription className={eyebrow}>
            Configura tu{" "}
            <NextLink href="/perfil" className="underline underline-offset-2 hover:text-neutral-900">
              perfil fisiológico
            </NextLink>{" "}
            para planificar tus bidones
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [routes, avgSpeedKmh] = await Promise.all([getStravaRoutes(), getAthleteAverageSpeedKmh()]);
  return <FuelingPlanner routes={routes} avgSpeedKmh={avgSpeedKmh} />;
}

async function ProfileCheckBannerSection() {
  const profile = await getAthleteProfile();
  const missingFields = getMissingProfileFields(profile);
  return <ProfileCheckBanner missingFields={missingFields} />;
}

function FuelingPlannerSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-3 w-64" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-8 w-36" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="h-9 w-32" />
      </CardContent>
    </Card>
  );
}

async function PostRideAnalysisSection() {
  const activities = await getRecentActivities(8);
  return (
    <PostRideAnalysis
      activities={activities.map((a) => ({
        id: a.id,
        name: a.name,
        activity_date: a.activity_date,
      }))}
    />
  );
}

function PostRideAnalysisSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-end gap-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-28" />
        </div>
      </CardContent>
    </Card>
  );
}

async function StravaButton() {
  const profile = await getProfile();
  const connected = Boolean(profile?.strava_athlete_id);

  if (!connected) {
    return (
      <a href="/api/strava/connect" className={cn(primaryButtonClass, "w-fit shrink-0")}>
        <Link2 className="size-3.5" />
        Conectar Strava
      </a>
    );
  }

  return <SyncForm />;
}

function StravaButtonSkeleton() {
  return <Skeleton className="h-7 w-28 rounded-lg" />;
}

// Login-time Strava errors (from `/api/auth/strava/callback`) surface on
// `/login` instead — the proxy never lets a logged-out visitor reach this
// page. The "Sincronizar rutas" button's own errors (`/api/strava/sync`) no
// longer round-trip through a query param either — `SyncForm` reports them
// via its own toast now, since the sync flow no longer navigates at all.
export default async function Home() {
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <header className="flex w-full items-center justify-between border-b border-neutral-200/80 pb-4">
        <div className="mr-2 flex min-w-0 flex-col">
          <Suspense fallback={<GreetingSkeleton />}>
            <GreetingSection />
          </Suspense>
          <h1 className="truncate font-mono text-xl font-bold tracking-tight text-neutral-900 uppercase sm:text-2xl">
            Dashboard
          </h1>
        </div>
        <Suspense fallback={<StravaButtonSkeleton />}>
          <StravaButton />
        </Suspense>
      </header>

      <Suspense fallback={null}>
        <ProfileCheckBannerSection />
      </Suspense>

      <Tabs defaultValue="pre-ride">
        <TabsList variant="line" className="w-full justify-start border-b border-neutral-200">
          <TabsTrigger
            value="pre-ride"
            className="flex-none text-[11px] font-semibold tracking-widest uppercase data-active:text-terracotta after:bg-terracotta"
          >
            Antes de salir
          </TabsTrigger>
          <TabsTrigger
            value="post-ride"
            className="flex-none text-[11px] font-semibold tracking-widest uppercase data-active:text-terracotta after:bg-terracotta"
          >
            Al llegar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pre-ride">
          <div className="flex flex-col gap-10 pt-4 sm:pt-6">
            <Suspense fallback={<FuelingPlannerSkeleton />}>
              <FuelingPlannerSection />
            </Suspense>
          </div>
        </TabsContent>

        <TabsContent value="post-ride">
          <div className="flex flex-col gap-10 pt-4 sm:pt-6">
            <Suspense fallback={<PostRideAnalysisSkeleton />}>
              <PostRideAnalysisSection />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
