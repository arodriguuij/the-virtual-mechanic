import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { RatioLogo } from "@/components/icons/RatioLogo";

export const metadata = {
  title: "Política de Privacidad — RATIO",
};

const h2Class = "font-mono text-sm font-bold tracking-wide text-neutral-900 uppercase";

/**
 * A real, public route (added to `PUBLIC_PATH_PREFIXES` in `proxy.ts` so it's
 * reachable with no session at all) rather than a page behind `DashboardShell`
 * — Strava's API Agreement requires a published privacy policy describing
 * what's collected via their API and how it's used, reachable *before* a
 * visitor connects their account, not only after logging in. Deliberately
 * not built on `components/login-hero.tsx`'s shared `LoginHeroLayout`: that
 * layout is built around a single compact hero card/video, which is wrong
 * for a long-form policy document that needs to scroll normally. Plain top
 * bar + a normal scrolling `<article>`.
 */
export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen w-full bg-[#FDFCF9]">
      <header className="flex w-full items-center justify-center border-b border-neutral-300/80 bg-[#FDFCF9] px-6 py-4">
        <Link
          href="/login"
          className="flex items-center gap-2 font-mono text-sm font-bold tracking-wider whitespace-nowrap text-neutral-900 uppercase"
        >
          <RatioLogo className="size-5 shrink-0 text-neutral-900" />
          RATIO
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12 sm:py-16">
        <div className="flex flex-col gap-2">
          <Link
            href="/login"
            className="flex w-fit items-center gap-1.5 font-mono text-xs text-neutral-500 hover:text-neutral-900"
          >
            <ArrowLeft className="size-3.5" />
            Volver
          </Link>
          <h1 className="font-mono text-xl font-bold tracking-tight text-neutral-900 uppercase sm:text-2xl">
            Política de privacidad
          </h1>
          <p className="font-mono text-xs text-neutral-500">
            Última actualización: julio de 2026
          </p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className={h2Class}>Qué es RATIO</h2>
          <p className="text-sm leading-relaxed text-neutral-700">
            RATIO es una herramienta de planificación nutricional para ciclistas:
            convierte tu FTP, tu peso y las condiciones reales de cada ruta (meteorología,
            desnivel) en un plan de hidratación y carbohidratos. Strava es el único método de
            acceso a la aplicación — no existe registro con email y contraseña propio.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={h2Class}>Qué datos de Strava leemos</h2>
          <p className="text-sm leading-relaxed text-neutral-700">
            Al conectar tu cuenta, Strava nos pide autorizar explícitamente los siguientes
            permisos, todos de <strong>solo lectura</strong>:
          </p>
          <ul className="flex list-none flex-col gap-2 text-sm text-neutral-700">
            <li className="flex items-start gap-2">
              <span className="font-mono text-xs font-bold text-terracotta">read</span>
              <span>Perfil público básico (nombre, avatar) para identificarte en la app.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono text-xs font-bold whitespace-nowrap text-terracotta">
                profile:read_all
              </span>
              <span>Tu peso registrado en Strava, para una sincronización de arranque.</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono text-xs font-bold whitespace-nowrap text-terracotta">
                activity:read_all
              </span>
              <span>
                Tus actividades de ciclismo (distancia, desnivel, potencia, ritmo cardiaco,
                ruta GPS) para calcular el gasto energético e hídrico real de cada salida.
              </span>
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-neutral-700">
            Nunca solicitamos permisos de escritura. RATIO no puede crear, editar,
            eliminar ni publicar nada en tu cuenta de Strava, bajo ninguna circunstancia.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={h2Class}>Qué datos nos proporcionas tú directamente</h2>
          <p className="text-sm leading-relaxed text-neutral-700">
            Además de lo anterior, tú introduces manualmente tu FTP, tasa de sudoración,
            fenotipo metabólico, nivel de adaptación digestiva y equipamiento de bidones en el
            Perfil Fisiológico — datos que existen únicamente en esta app, no en Strava, y que
            solo tú puedes ver o modificar.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={h2Class}>Para qué usamos estos datos</h2>
          <p className="text-sm leading-relaxed text-neutral-700">
            Exclusivamente para calcular tus recomendaciones de nutrición e hidratación —
            gramos de carbohidrato por hora, sodio, la receta de bidón casero, y el balance
            de recuperación tras cada ruta. No usamos tus datos para publicidad, perfilado
            comercial, ni ningún fin ajeno a esta función.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={h2Class}>Con quién compartimos tus datos</h2>
          <p className="text-sm leading-relaxed text-neutral-700">
            Con nadie. No vendemos, alquilamos ni compartimos tus datos personales o de Strava
            con terceros bajo ninguna circunstancia. Tus datos se almacenan en Supabase (nuestro
            proveedor de base de datos), protegidos por reglas de acceso a nivel de fila que
            garantizan que cada persona solo puede leer o modificar sus propios datos — ni
            siquiera otro usuario de la app puede acceder a los tuyos.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={h2Class}>Cómo revocar el acceso</h2>
          <p className="text-sm leading-relaxed text-neutral-700">
            Puedes desconectar RATIO en cualquier momento desde{" "}
            <a
              href="https://www.strava.com/settings/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              strava.com/settings/apps
            </a>{" "}
            — esto revoca inmediatamente nuestro acceso de lectura a tu cuenta. Para solicitar
            la eliminación completa de los datos que hemos almacenado, escríbenos a la
            dirección de contacto indicada más abajo.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={h2Class}>Contacto</h2>
          <p className="text-sm leading-relaxed text-neutral-700">
            Para cualquier consulta sobre esta política o tus datos, contacta con nosotros en{" "}
            <a
              href="mailto:arodriguuij@gmail.com"
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              arodriguuij@gmail.com
            </a>
            .
          </p>
        </section>
      </main>
    </div>
  );
}
