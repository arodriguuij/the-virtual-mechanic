"use client";

import { Check } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Confirms a successful `/api/athlete-profile/update` save. The route's
 * redirect carries `?profile_saved=1` (same query-param convention as
 * `profile_error`/`strava_error`) onto `/perfil`, but unlike those persistent
 * warning banners this is a self-dismissing toast — it fades out and strips
 * the query param (via the current pathname, not a hardcoded one, so this
 * stays correct if it's ever reused from another page) after a few seconds
 * so a page refresh doesn't keep re-showing a save confirmation for an
 * action that already happened.
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
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 border border-status-good/30 bg-status-good/10 px-4 py-3 text-sm text-status-good shadow-sm">
      <Check className="size-4 shrink-0" />
      Perfil metabólico actualizado correctamente
    </div>
  );
}
