import { TriangleAlert } from "lucide-react";

import { AuthPageShell } from "@/components/auth-page-shell";
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
    <AuthPageShell>
      <h1 className="mb-4 max-w-lg px-4 text-center font-mono text-xl font-bold tracking-tight text-neutral-900 uppercase sm:mb-6 sm:text-3xl">
        Nutrición de precisión para ciclistas
      </h1>

      <ul className="my-6 w-full max-w-70 space-y-2.5 text-left font-mono text-xs text-neutral-800">
        {benefits.map((benefit) => (
          <li key={benefit} className="flex items-start gap-2">
            <span className="font-bold text-terracotta">&#10003;</span>
            {benefit}
          </li>
        ))}
      </ul>

      {error && (
        <div className="mx-auto mb-4 flex w-full max-w-70 items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-left text-sm text-status-warning">
          <TriangleAlert className="size-4 shrink-0" />
          {error}
        </div>
      )}

      <StravaLoginButton />

      <p className="mt-2 text-center font-mono text-[10px] text-neutral-500 sm:mt-3 sm:text-[11px]">
        Acceso seguro mediante OAuth. Solo lectura de rutas.
      </p>
    </AuthPageShell>
  );
}
