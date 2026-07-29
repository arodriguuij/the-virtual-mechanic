import { Lock } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { primaryButtonClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

/**
 * Replaces the whole "Al llegar" tab whenever there's no real FTP on file —
 * every glycogen-debt tier in `POST /api/post-ride/analysis`, even the ones
 * that don't need a power meter (heart-rate, self-reported RPE), still needs
 * *some* `athlete_profiles` row to read weight/sweat-rate/athlete-type from,
 * and since that row only ever exists once the athlete has submitted the
 * real Physiological Profile form (see "Eliminating profile fallbacks" in
 * CLAUDE.md), a missing FTP here always means a missing profile entirely.
 * Showing this instead of letting `PostRideAnalysis` mount, auto-analyze,
 * and fail with the generic "No se pudo analizar la ruta" fetch error turns
 * an opaque dead end into one concrete next step. `Lock`, not a literal 🔒 —
 * this app's no-emoji-in-chrome convention applies here too (see
 * `components/profile-required-banner.tsx`'s own button treatment).
 */
export function FtpRequiredNotice() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4 shrink-0" />
          Análisis restringido
        </CardTitle>
        <CardDescription>
          Para calcular la deuda de glucógeno real y la recuperación por macros post-ruta,
          introduce tu FTP en el Perfil Fisiológico.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/perfil" className={cn(primaryButtonClass, "w-fit px-5 py-2.5 text-xs")}>
          Configurar FTP →
        </Link>
      </CardContent>
    </Card>
  );
}
