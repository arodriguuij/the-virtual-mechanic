import { TriangleAlert } from "lucide-react";

import { AppLogo } from "@/components/app-logo";
import { StravaLoginButton } from "@/components/strava-login-button";

export const dynamic = "force-dynamic";

const stravaLoginErrorMessages: Record<string, string> = {
  access_denied: "Cancelaste la conexión con Strava.",
  missing_code: "Strava no envió un código de autorización válido.",
  token_exchange_failed: "No se pudo intercambiar el código con Strava.",
  missing_athlete_id: "Strava no devolvió tu identidad de atleta — inténtalo de nuevo.",
  auth_bridge_failed: "No se pudo iniciar sesión en Motor Metabólico. Inténtalo de nuevo.",
  save_failed: "No se pudieron guardar los tokens de Strava.",
};

const benefits = [
  "Recetas exactas de glucosa y fructosa",
  "Ajuste por meteorología en tiempo real",
  "Pautas listas para tu mezcla casera",
];

const specs = ["01 / Ratio 1:0.8 optimizado", "02 / Meteorología en vivo", "03 / Mezcla casera"];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const errorCode = params.strava_error;
  const error =
    typeof errorCode === "string"
      ? (stravaLoginErrorMessages[errorCode] ?? "No se pudo completar la conexión con Strava.")
      : null;

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#FDFCF9]">
      <header className="flex items-center justify-between border-b border-neutral-300/80 bg-[#FDFCF9] px-6 py-4">
        <div className="flex shrink-0 items-center gap-2">
          <AppLogo className="size-5 shrink-0" />
          <span className="font-mono text-sm font-bold whitespace-nowrap text-neutral-900 tracking-wider">
            Motor Metabólico
          </span>
        </div>
        <span className="shrink-0 text-right font-mono text-[10px] whitespace-nowrap text-neutral-500 uppercase tracking-widest">
          <span className="sm:hidden">V1.0</span>
          <span className="hidden sm:inline">V1.0 · Nutrición de precisión</span>
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <h1 className="mb-6 max-w-lg text-center font-mono text-2xl font-bold tracking-tight text-neutral-900 uppercase sm:text-3xl">
          Nutrición de precisión para ciclistas
        </h1>

        <ul className="mx-auto mb-8 max-w-xs space-y-3 font-mono text-xs text-neutral-700">
          {benefits.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2">
              <span className="text-terracotta">&#10003;</span>
              {benefit}
            </li>
          ))}
        </ul>

        {error && (
          <div className="mx-auto mb-4 flex w-full max-w-xs items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-left text-sm text-status-warning">
            <TriangleAlert className="size-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="mx-auto w-full max-w-xs">
          <StravaLoginButton />
        </div>

        <p className="mt-4 text-center font-mono text-[11px] text-neutral-500">
          Acceso seguro mediante OAuth. Solo lectura de rutas.
        </p>
      </main>

      <footer className="border-t border-neutral-300/80 bg-[#FDFCF9] px-6 py-4">
        <div className="flex flex-col items-center gap-1 font-mono text-[10px] tracking-wider text-neutral-500 uppercase sm:flex-row sm:justify-center sm:gap-x-12">
          {specs.map((spec) => (
            <span key={spec} className="whitespace-nowrap">
              {spec}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
