"use client";

import { Check, RefreshCw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * `useFormStatus` only tracks pending state when the enclosing `<form>`'s
 * `action` is a real function — a plain string URL is a native browser
 * submission React never intercepts, so `pending` would stay `false`
 * forever. `SyncForm` below passes a client action function instead (still
 * hitting the exact same `POST /api/strava/sync` route), which is what
 * makes this component's pending state real.
 *
 * Collapses to an icon + short "Sync" label on mobile — the full
 * "Sincronizar Strava" text next to the Dashboard's own greeting/title
 * overflowed a narrow phone and clipped the greeting text.
 */
function SyncButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      title="Sincronizar rutas con Strava"
      className="flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-neutral-700 shadow-sm transition-all duration-150 hover:border-neutral-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 sm:py-2"
    >
      <RefreshCw className={cn("size-4 text-[#FC4C02]", pending && "animate-spin")} />
      <span className="hidden font-mono text-xs font-semibold tracking-wider uppercase sm:inline">
        {pending ? "Sincronizando..." : "Sincronizar Strava"}
      </span>
      <span className="font-mono text-[10px] font-semibold tracking-wider text-neutral-600 uppercase sm:hidden">
        {pending ? "..." : "Sync"}
      </span>
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
 * `ProfileSavedToast`) reports success or failure without needing a
 * query-param round-trip through a page navigation.
 */
type Toast = { kind: "success" | "error"; title: string; message: string };

export function SyncForm() {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);

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
      {toast && (
        <div className="animate-in fade-in slide-in-from-bottom-4 pointer-events-auto fixed bottom-6 left-1/2 z-10000 flex w-[90%] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border border-neutral-200/90 bg-white px-4 py-3 text-neutral-900 shadow-xl duration-200">
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border",
              toast.kind === "success"
                ? "border-emerald-200/60 bg-emerald-50 text-emerald-600"
                : "border-red-200/60 bg-red-50 text-red-600"
            )}
          >
            {toast.kind === "success" ? (
              <Check className="size-4 stroke-[2.5]" />
            ) : (
              <TriangleAlert className="size-4 stroke-[2.5]" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-bold tracking-wider text-neutral-900 uppercase">
              {toast.title}
            </p>
            <p className="mt-0.5 truncate font-sans text-xs text-neutral-600">{toast.message}</p>
          </div>
        </div>
      )}
    </>
  );
}
