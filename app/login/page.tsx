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
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#FDFCF9] p-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: "radial-gradient(#171717 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      <div className="relative z-10 w-full max-w-md rounded-lg border border-neutral-200/90 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center">
          <AppLogo className="size-10 shrink-0" />
          <span className="mt-2 text-xs font-bold tracking-[0.2em] text-neutral-900 uppercase">
            Motor Metabólico
          </span>
          <h1 className="mt-2 text-center font-mono text-xl font-bold tracking-tight text-neutral-900 uppercase">
            Nutrición de precisión
          </h1>
        </div>

        <ul className="my-6 space-y-2.5 font-mono text-xs text-neutral-700">
          {benefits.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2">
              <span className="text-terracotta">&#10003;</span>
              {benefit}
            </li>
          ))}
        </ul>

        {error && (
          <div className="mb-4 flex w-full items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-left text-sm text-status-warning">
            <TriangleAlert className="size-4 shrink-0" />
            {error}
          </div>
        )}

        <StravaLoginButton />

        <p className="mt-3 text-center font-mono text-[11px] text-neutral-400">
          Acceso seguro mediante OAuth. Solo leemos tus rutas.
        </p>
      </div>
    </div>
  );
}
