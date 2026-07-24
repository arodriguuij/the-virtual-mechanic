"use client";

import { RefreshCw } from "lucide-react";
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
      <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
      {pending ? "Sincronizando…" : "Sincronizar rutas"}
    </button>
  );
}

/**
 * Same real sync as a native form POST — the action function just fetches
 * `/api/strava/sync` itself instead of letting the browser submit natively,
 * so `useFormStatus` has a real transition to track. The route always
 * redirects (to `/` or `/?strava_error=<code>`); `fetch` follows that
 * automatically, so `res.url` is the final destination — navigating there
 * for real preserves the exact same error-surfacing behavior a native
 * submit would have had.
 */
export function SyncForm({ className }: { className?: string }) {
  async function syncAction() {
    const res = await fetch("/api/strava/sync", { method: "POST" });
    window.location.href = res.url || "/";
  }

  return (
    <form action={syncAction}>
      <SyncButton className={className} />
    </form>
  );
}
