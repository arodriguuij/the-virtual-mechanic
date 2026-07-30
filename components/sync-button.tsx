"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils";
import { Toast, type ToastData } from "@/components/toast";
import { secondaryButtonClass } from "@/lib/ui-classes";

/**
 * `useFormStatus` only tracks pending state when the enclosing `<form>`'s
 * `action` is a real function — a plain string URL is a native browser
 * submission React never intercepts, so `pending` would stay `false`
 * forever. `SyncForm` below passes a client action function instead (still
 * hitting the exact same `POST /api/strava/sync` route), which is what
 * makes this component's pending state real.
 *
 * Now renders through the shared `secondaryButtonClass` (`lib/ui-classes.ts`)
 * instead of its own one-off `bg-white`/`text-[#FC4C02]` treatment — the
 * previous white-card-plus-Strava-orange pairing broke the PNS editorial
 * palette every other button in the app already follows, and gave this one
 * button a fourth, undocumented button style. The `RefreshCw` icon carries
 * no color class of its own, so it simply inherits whatever text color the
 * button itself is using (`text-terracotta` at rest, `text-white` on hover/
 * disabled) rather than a hardcoded Strava-orange fill.
 */
function SyncButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      title="Sincronizar rutas con Strava"
      className={cn(secondaryButtonClass, "shrink-0 px-3 py-1.5 text-xs sm:px-4 sm:py-2")}
    >
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
      {pending ? "Sincronizando..." : "Sincronizar"}
    </button>
  );
}

const syncErrorMessages: Record<string, string> = {
  no_session: "Tu sesión expiró — vuelve a iniciar sesión.",
  not_connected: "Conecta Strava antes de sincronizar rutas.",
  no_rides: "No se encontró ninguna actividad de ciclismo reciente en Strava.",
};

/**
 * Calls `/api/strava/sync` (now a plain JSON API — see that route's own
 * comments for why it no longer redirects) and, on success, calls
 * `router.refresh()` instead of navigating anywhere. `router.refresh()` is
 * the App Router's own "re-run every Server Component on this route without
 * a full page reload" primitive: it re-fetches `getRecentActivities()`, the
 * Weekly Performance Panel, etc. with the freshly synced data, but — unlike
 * `window.location.href`/`.reload()`, what this used to do — never remounts
 * the client components below it, so `FuelingPlanner`'s own in-progress
 * state (pocket food selections, departure time, calculated result) survives
 * completely untouched. A toast (self-dismissing, same visual pattern as
 * `ProfileSavedToast`, which now renders through the same shared `Toast`
 * component this one does) reports success or failure without needing a
 * query-param round-trip through a page navigation.
 */
export function SyncForm() {
  const router = useRouter();
  const [toast, setToast] = useState<ToastData | null>(null);

  async function syncAction() {
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setToast({
          kind: "error",
          title: "Error de sincronización",
          message: syncErrorMessages[data.error] ?? "No se pudo sincronizar con Strava.",
        });
        return;
      }
      setToast({
        kind: "success",
        title: "Sincronización completada",
        message: "Rutas y datos de Strava actualizados",
      });
      router.refresh();
    } catch {
      setToast({
        kind: "error",
        title: "Error de sincronización",
        message: "No se pudo sincronizar con Strava.",
      });
    } finally {
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <>
      <form action={syncAction}>
        <SyncButton />
      </form>
      {toast && <Toast toast={toast} />}
    </>
  );
}
