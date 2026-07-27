import { Flame, Link2, TriangleAlert } from "lucide-react";

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
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-8 text-center">
        <div className="flex items-center gap-2 text-sm font-bold tracking-[0.2em] text-neutral-900 uppercase">
          <Flame className="size-5" strokeWidth={1.5} />
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

        <a
          href="/api/strava/connect"
          className="inline-flex w-full cursor-pointer items-center justify-center gap-2 border border-neutral-900 bg-neutral-900 px-6 py-3 text-xs font-bold tracking-widest text-background uppercase transition-colors duration-150 hover:bg-background hover:text-neutral-900"
        >
          <Link2 className="size-4" />
          Conectar con Strava
        </a>

        <p className="text-xs text-neutral-400">
          Strava es el único método de acceso — tu cuenta y tus rutas se vinculan
          automáticamente al conectar.
        </p>
      </div>
    </div>
  );
}
