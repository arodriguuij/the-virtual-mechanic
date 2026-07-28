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
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200/80 bg-white p-8 text-center shadow-sm sm:p-10">
        <div className="flex flex-col items-center gap-8">
          <div className="flex items-center gap-2 text-sm font-bold tracking-[0.2em] text-neutral-900 uppercase">
            <AppLogo className="size-5" />
            Motor Metabólico
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold tracking-wide text-neutral-900 uppercase">
              Fueling de precisión para ciclistas
            </h1>
            <p className="text-sm text-neutral-500">
              Convierte tu FTP, peso y las condiciones reales de cada ruta en un plan de
              hidratación y carbohidratos exacto — antes y después de pedalear.
            </p>
          </div>

          {error && (
            <div className="flex w-full items-center gap-2 border border-status-warning/30 bg-status-warning/10 px-4 py-3 text-left text-sm text-status-warning">
              <TriangleAlert className="size-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex w-full flex-col">
            <StravaLoginButton />
            <p className="mt-4 font-sans text-[11px] leading-relaxed text-neutral-400">
              Acceso seguro mediante OAuth. Solo leemos tus rutas para calcular tu nutrición
              y jamás publicaremos nada en tu cuenta de Strava.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
