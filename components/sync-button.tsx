"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormStatus } from "react-dom";

import { cn } from "@/lib/utils";
import { Toast, type ToastData } from "@/components/toast";

/**
 * A deliberately quieter treatment than the shared `secondaryButtonClass`
 * (`lib/ui-classes.ts`, still used by Copiar receta/Descargar GPX/Recargar
 * rutas) — this button sits directly in the Dashboard header next to the
 * greeting, so it reads as PNS-style "transparent, barely-there chrome"
 * rather than a bold outlined pill: no fill at rest, a hairline
 * `terracotta/40` border, sentence-case label (no `uppercase`/`font-mono`/
 * `tracking-wider`), and a soft `hover:bg-white/50` instead of the shared
 * class's hover-fills-solid-bronze behavior. Kept as its own local class
 * rather than an override of `secondaryButtonClass` — the two diverge on
 * almost every axis (fill, case, tracking, font), so composing on top of
 * the shared class would mean overriding most of it anyway.
 */
const syncButtonClass =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-terracotta/40 bg-transparent px-3.5 py-1.5 text-xs font-medium text-zinc-700 transition-colors duration-150 hover:border-terracotta hover:bg-white/50 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm";

/**
 * `useFormStatus` only tracks pending state when the enclosing `<form>`'s
 * `action` is a real function — a plain string URL is a native browser
 * submission React never intercepts, so `pending` would stay `false`
 * forever. `SyncForm` below passes a client action function instead (still
 * hitting the exact same `POST /api/strava/sync` route), which is what
 * makes this component's pending state real. The `RefreshCw` icon carries
 * no color class of its own, so it simply inherits whatever text color the
 * button itself is using.
 */
function SyncButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} title="Sincronizar rutas con Strava" className={syncButtonClass}>
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
