import { Lock } from "lucide-react";
import Link from "next/link";

import { primaryButtonClass } from "@/lib/ui-classes";
import { cn } from "@/lib/utils";

/**
 * Shared "sección bloqueada" card for both Dashboard tabs — replaces two
 * previously independent, differently-worded/-styled cards
 * (`FuelingPlannerSection`'s own inline "configura tu perfil" `Card` and the
 * standalone `FtpRequiredNotice`) with one component, so "Antes de salir" and
 * "Al llegar" can no longer drift into inconsistent copy or styling. `title`/
 * `description` are the only things that differ between the two call sites.
 *
 * Deliberately its own visual language (a bordered, cream-tinted block, not
 * the plain white `Card` primitive) — this reads as a calibration checkpoint
 * gating the whole section, not just another content card. `border-terracotta/30`/
 * `bg-surface/80` reuse this app's own design tokens rather than a hardcoded
 * cream/bronze hex pair. `Lock`, not a literal 🔒 — this app's
 * no-emoji-in-chrome convention applies here too.
 */
export function ProfileRequiredCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="w-full space-y-3 rounded-xl border border-terracotta/30 bg-surface/80 p-6 text-left">
      <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-terracotta uppercase">
        <Lock className="size-3.5 shrink-0" />
        Calibración fisiológica requerida
      </div>

      <h3 className="font-mono text-lg font-bold tracking-tight text-neutral-900 uppercase">{title}</h3>

      <p className="max-w-xl text-sm leading-relaxed text-neutral-600">{description}</p>

      <div className="pt-2">
        <Link href="/perfil" className={cn(primaryButtonClass, "inline-flex px-4 py-2.5 text-xs")}>
          Completar perfil fisiológico →
        </Link>
      </div>
    </div>
  );
}
