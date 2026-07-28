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
 */
function SyncButton({ className }: { className?: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} className={cn(className, pending && "opacity-70")}>
      <RefreshCw className={cn("mr-1.5 size-3.5 shrink-0", pending && "animate-spin")} />
      {pending ? "SINCRONIZANDO..." : "SINCRONIZAR STRAVA"}
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
export function SyncForm({ className }: { className?: string }) {
  const router = useRouter();
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function syncAction() {
    try {
      const res = await fetch("/api/strava/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setToast({
          kind: "error",
          message: syncErrorMessages[data.error] ?? "No se pudo sincronizar con Strava.",
        });
        return;
      }
      setToast({ kind: "success", message: "Rutas y datos de Strava actualizados correctamente" });
      router.refresh();
    } catch {
      setToast({ kind: "error", message: "No se pudo sincronizar con Strava." });
    } finally {
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <>
      <form action={syncAction}>
        <SyncButton className={className} />
      </form>
      {toast && (
        <div
          className={cn(
            "fixed right-6 bottom-6 z-50 flex items-center gap-2 border px-4 py-3 text-sm shadow-sm",
            toast.kind === "success"
              ? "border-status-good/30 bg-status-good/10 text-status-good"
              : "border-status-warning/30 bg-status-warning/10 text-status-warning"
          )}
        >
          {toast.kind === "success" ? (
            <Check className="size-4 shrink-0" />
          ) : (
            <TriangleAlert className="size-4 shrink-0" />
          )}
          {toast.message}
        </div>
      )}
    </>
  );
}
