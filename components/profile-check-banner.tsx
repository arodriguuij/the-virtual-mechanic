"use client";

import { TriangleAlert, X } from "lucide-react";
import NextLink from "next/link";
import { useEffect, useState } from "react";

import type { MissingProfileField } from "@/lib/dashboard-data";

const FIELD_LABELS: Record<MissingProfileField, string> = {
  ftp: "tu FTP",
  sweat_rate: "tu sudoración",
  weight: "tu peso",
};

function buildMessage(missingFields: MissingProfileField[]): string {
  const labels = missingFields.map((field) => FIELD_LABELS[field]);
  const joined =
    labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
  return `Falta configurar ${joined} para calibrar tu receta.`;
}

const DISMISS_KEY = "profile_check_banner_dismissed";

/**
 * "Banner de Onboarding Dinámico" — a dismissible top-of-dashboard nudge
 * whenever `athlete_profiles` still looks untouched (see
 * `getMissingProfileFields` in `lib/dashboard-data.ts`), so a new athlete
 * knows *why* their fueling numbers might look generic before they've ever
 * opened the profile form. The dismiss preference is `localStorage`-only
 * (same convention as
 * the planner's offline-strategy cache) — a private-browsing/quota failure
 * just means the dismiss doesn't persist across sessions, never a broken
 * banner.
 */
export function ProfileCheckBanner({ missingFields }: { missingFields: MissingProfileField[] }) {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    function loadDismissedPreference() {
      try {
        setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
      } catch {
        setDismissed(false);
      }
    }
    loadDismissedPreference();
  }, []);

  if (missingFields.length === 0 || dismissed) return null;

  function handleDismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Private browsing / quota exceeded — dismiss still holds for this
      // session via state, just won't persist to the next one.
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-neutral-300 bg-neutral-50/60 px-4 py-3 text-sm text-neutral-700">
      <div className="flex items-center gap-2">
        <TriangleAlert className="size-4 shrink-0 text-neutral-500" />
        <span>{buildMessage(missingFields)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <NextLink
          href="/perfil"
          className="text-[11px] font-semibold tracking-widest text-neutral-900 uppercase underline underline-offset-2 hover:no-underline"
        >
          Perfil fisiológico
        </NextLink>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Cerrar aviso"
          className="cursor-pointer text-neutral-400 transition-colors duration-150 hover:text-neutral-900"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
