"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Toast } from "@/components/toast";

/**
 * Confirms a successful `/api/athlete-profile/update` save. The route's
 * redirect carries `?profile_saved=1` (same query-param convention as
 * `profile_error`/`strava_error`) onto `/perfil`, but unlike those persistent
 * warning banners this is a self-dismissing toast — it fades out and strips
 * the query param (via the current pathname, not a hardcoded one, so this
 * stays correct if it's ever reused from another page) after a few seconds
 * so a page refresh doesn't keep re-showing a save confirmation for an
 * action that already happened.
 *
 * Renders through the shared `Toast` component (`components/toast.tsx`) —
 * the same fixed bottom-center white pill `SyncForm`'s Strava-sync
 * confirmation already uses — rather than its own one-off `fixed bottom-6
 * right-6` box. The two used to look and behave differently despite both
 * being "the app's toast," which is exactly the kind of drift this shared
 * component exists to prevent.
 */
export function ProfileSavedToast() {
  const [visible, setVisible] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const timeout = setTimeout(() => {
      setVisible(false);
      router.replace(pathname, { scroll: false });
    }, 3000);
    return () => clearTimeout(timeout);
  }, [router, pathname]);

  if (!visible) return null;

  return (
    <Toast
      toast={{
        kind: "success",
        title: "Perfil actualizado",
        message: "Cambios guardados correctamente",
      }}
    />
  );
}
