import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

// "Base Científica" — a public-facing, plain-language writeup of every
// formula/constant this app's own `lib/metabolic-engine.ts` actually runs,
// not a generic sports-nutrition primer. Every figure below is pulled
// straight from that file's real exported functions/constants (cited in the
// prose so a curious athlete — or a future maintainer — can go verify it
// directly), never a textbook formula this app doesn't actually compute.
// Static content, no data fetch — a plain Server Component like `/privacidad`.

const eyebrow = "font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase";

function EquationBlock({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-[#F8F7F5] p-3 font-mono text-xs leading-relaxed text-zinc-800 sm:text-sm">
      {children}
    </div>
  );
}

function SourceNote({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-zinc-400 italic">{children}</p>;
}

function MethodologyCard({
  number,
  title,
  defaultOpen = false,
  children,
}: {
  number: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border-0 bg-white p-5 shadow-none sm:p-6"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={eyebrow}>{number}</span>
          <span className="text-base font-semibold text-zinc-900">{title}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-zinc-400 transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div className="mt-4 flex flex-col gap-4 border-t border-zinc-100 pt-4 text-sm leading-relaxed text-zinc-700">
        {children}
      </div>
    </details>
  );
}

export default function MetodologiaPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-bold font-mono text-neutral-900 uppercase tracking-tight sm:text-2xl">
          Base científica
        </h1>
        <p className="mt-1 text-xs font-mono leading-relaxed text-neutral-500">
          Cada ecuación, factor de corrección y umbral que usa el motor metabólico de RATIO —
          documentado tal y como está implementado, no una versión simplificada.
        </p>
      </header>

      <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
        RATIO no es una tabla de nutrición deportiva genérica: cada cifra que ves en el
        planificador sale de un motor de fórmulas propio (<code className="font-mono text-xs">
          lib/metabolic-engine.ts
        </code>
        ), heurístico y documentado, apoyado en literatura habitual de nutrición deportiva —{" "}
        <strong>no</strong> es un modelo clínico ni individualmente calibrado con un test de
        laboratorio real. Esta página explica exactamente qué calcula cada número.
      </p>

      <div className="flex flex-col gap-4">
        <MethodologyCard number="01 ·" title="Modelo energético y consumo de glucógeno" defaultOpen>
          <p>
            <strong>Duración estimada de ruta.</strong> Para una ruta guardada o un GPX, RATIO no
            usa una única velocidad media: descompone el trazado en tramos de subida, bajada y
            llano, y calcula el tiempo de cada uno por separado a partir de la intensidad objetivo
            elegida (Recuperación → Competición), ya que esa elección cambia el vatiaje real
            aplicado y, con él, la duración total.
          </p>
          <EquationBlock>
            VAM (m/h) = clamp(300, 1800, W/kg_total × 285)
            <br />
            V_llano (km/h) = clamp(15, 50, 24 × (P_objetivo / 100)^0.33)
            <br />
            V_bajada = 42 km/h (fijo) · Margen de paradas = +3%
          </EquationBlock>
          <p>
            <code className="font-mono text-xs">W/kg_total</code> usa el peso del ciclista más un
            peso de bici estimado de 8kg (no hay campo real de peso de bici todavía).{" "}
            <code className="font-mono text-xs">P_objetivo</code> es el FTP del perfil × el %FTP
            de la intensidad elegida (Recuperación 55% · Fondo 70% · Tempo 85% · Umbral 98% ·
            VO2 Max 115% · Competición 120%).
          </p>
          <p>
            <strong>Tasa de oxidación de carbohidratos</strong> (g/h) se banda por intensidad
            relativa (%FTP), siguiendo la progresión habitual de la literatura de nutrición
            deportiva hasta el techo práctico de absorción intestinal:
          </p>
          <EquationBlock>
            &lt;50% FTP → 30 g/h · &lt;65% → 45 g/h · &lt;80% → 60 g/h
            <br />
            &lt;95% → 75 g/h · &lt;110% → 90 g/h · ≥110% → 100 g/h
          </EquationBlock>
          <p>
            <strong>Fenotipo metabólico (VLaMax simplificado).</strong> Un perfil &quot;Diésel&quot;
            quema proporcionalmente menos glucógeno a ritmos suaves (mayor eficiencia grasa); uno
            &quot;Explosivo&quot; quema más. Por encima de tempo (≥80% FTP) todo el mundo quema
            glucolíticamente por igual, así que el ajuste solo se aplica por debajo de ese umbral:
          </p>
          <EquationBlock>
            Diésel ×0.85 · Balanced ×1.00 · Explosivo ×1.15 (solo si intensidad relativa &lt; 80% FTP)
          </EquationBlock>
          <SourceNote>
            getCarbOxidationRateGPerHour · getPersonalizedCarbOxidationRateGPerHour ·
            estimateRideDurationHours
          </SourceNote>
        </MethodologyCard>

        <MethodologyCard number="02 ·" title="Capacidad digestiva y límite intestinal">
          <p>
            El intestino es entrenable: recomendar más carbohidratos de los que el ciclista ha
            practicado absorber solo causa malestar gástrico, no más energía útil. Por eso la
            recomendación final nunca supera el techo de su nivel de Gut Training, aunque la
            intensidad de la ruta pida más:
          </p>
          <EquationBlock>
            Tasa recomendada (g/h) = min(Tasa teórica por vatios, Cap_digestiva)
            <br />
            Principiante 50 g/h · Intermedio 75 g/h · Avanzado 90 g/h · Pro 120 g/h
          </EquationBlock>
          <p>
            <strong>Ratio maltodextrina:fructosa</strong> escala con la tasa real de carbohidratos
            de la ruta, no es fijo — por debajo de 45g/h un único transportador (SGLT1) ya cubre
            la demanda; entre 45-75g/h se empieza a reclutar el transportador de fructosa (GLUT5)
            con un ratio 2:1; por encima de 75g/h, donde SGLT1 va saturado, el ratio se acerca al
            máximo de absorción dual (~1:0.8, es decir ~1.25 partes de malto por cada parte de
            fructosa):
          </p>
          <EquationBlock>
            &lt;45 g/h → 100% maltodextrina
            <br />
            45-75 g/h → 2:1 maltodextrina:fructosa
            <br />
            &gt;75 g/h → 1:0.8 maltodextrina:fructosa
          </EquationBlock>
          <p>
            El checkbox &quot;Ruta objetivo / Competición&quot; fuerza el ratio 1:0.8 desde el principio,
            aunque la tasa de la ruta no llegue a 75g/h — en una prueba importante merece la pena
            exprimir la absorción dual desde el primer sorbo.
          </p>
          <SourceNote>getGutCappedCarbTarget · getMaltodextrinFraction</SourceNote>
        </MethodologyCard>

        <MethodologyCard number="03 ·" title="Termorregulación y datos meteorológicos (Open-Meteo)">
          <p>
            <strong>Corrección térmica.</strong> Por debajo de 25°C, el calor sube la tasa de
            sudoración de forma gradual; a partir de ahí la demanda de refrigeración del cuerpo
            deja de escalar linealmente, así que se aplica un salto fijo en vez de continuar la
            pendiente. La humedad siempre escala de forma suave:
          </p>
          <EquationBlock>
            F_calor = 1 + max(0, T − 18) × 0.02 (si T ≤ 25°C) · si no, F_calor = 1.2 (fijo)
            <br />
            F_humedad = 1 + max(0, H − 50) × 0.004
            <br />
            Tasa sudor (ml/h) = Tasa base × F_calor × F_humedad
          </EquationBlock>
          <p>
            <strong>Muestreo geográfico.</strong> Para una ruta con puerto conocido (Strava o GPX),
            RATIO no se conforma con la temperatura de salida: consulta Open-Meteo en tres puntos
            reales — inicio, punto más alto y llegada — cada uno con su hora estimada de paso. Si
            no hay perfil de altitud real disponible (Entreno Manual o una ruta sin desnivel
            relevante), usa una previsión de una sola ubicación promediada durante toda la
            ventana horaria de la salida, y corrige la temperatura por la altitud ganada:
          </p>
          <EquationBlock>
            Corrección por altitud = −6.5°C por cada 1000m de desnivel acumulado (−0.65°C/100m)
          </EquationBlock>
          <p>
            Esa corrección por desnivel se omite cuando el muestreo real de 3 puntos ya midió la
            temperatura en el punto más alto directamente — es redundante corregir una
            aproximación cuando ya hay un dato real.
          </p>
          <SourceNote>getHeatHumidityMultiplier · getLapseRateAdjustedTemperature · getWeatherForRoute</SourceNote>
        </MethodologyCard>

        <MethodologyCard number="04 ·" title="Balance hídrico y reposición de sodio">
          <EquationBlock>
            Tasa sudor base (ml/h): Baja 500 · Media 750 · Alta 1000
            <br />
            Sodio (mg/h) = (Tasa hidratación (ml/h) / 1000) × Concentración sodio (mg/L)
            <br />
            Concentración: 700 mg/L (típico) · 1200 mg/L (sudador salado)
          </EquationBlock>
          <p>
            La concentración de sodio en sudor varía enormemente entre individuos (la literatura
            cita un rango real de ~400 a 1500 mg/L) — RATIO usa 700 mg/L como valor típico y 1200
            mg/L para quien marca &quot;sudor especialmente salado&quot; en su perfil (cercos blancos en el
            maillot, escozor en los ojos), ya que infra-dosificar sodio a un sudador salado real
            arriesga calambres y, en salidas largas y calurosas, hiponatremia.
          </p>
          <SourceNote>getFluidLossMlPerHour · getSodiumLossMgPerHour</SourceNote>
        </MethodologyCard>

        <MethodologyCard number="05 ·" title="Formulación de mezcla casera y sincronización">
          <p>
            La receta de bidón no es una dosis fija — se calcula a partir del objetivo real de
            carbohidratos/hora del ciclista (ya limitado por su capacidad digestiva, ver Bloque
            02) y se reparte entre tantos bidones como haga falta para no superar dos límites
            físicos independientes por bidón: la concentración cómoda para el vaciado gástrico, y
            el límite real de solubilidad del polvo en agua fría.
          </p>
          <EquationBlock>
            Concentración máxima por bidón = 8% del volumen (margen de seguridad bajo el 10-12%
            citado como umbral de malestar gástrico)
            <br />
            Límite de solubilidad = 140 g de polvo por litro de agua
          </EquationBlock>
          <p>
            El bidón se dimensiona con el que sea más estricto de los dos límites, usando la
            capacidad real del bidón configurada en el perfil (500 / 600 / 750 / 950 ml) — nunca
            un tamaño fijo. Por ejemplo, con el límite del 8% de concentración, un bidón de 750ml
            admite hasta 60g de carbohidratos disueltos; uno de 500ml, hasta 40g.
          </p>
          <p>
            <strong>Sincronización de cafeína.</strong> Solo se programa un hito de cafeína si el
            ciclista marca &quot;Incluye cafeína&quot; en algún gel/alimento seleccionado — nunca de forma
            automática. El momento se ancla al esfuerzo más exigente de la ruta:
          </p>
          <EquationBlock>
            Rutas con puerto tardío: 45 min antes del punto más alto
            <br />
            Rutas llanas / Entreno Manual: 45 min antes del final de la salida
            <br />
            Suelo mínimo: nunca antes del 65% de la ruta (evita cafeína prematura en un puerto
            cercano a la salida)
          </EquationBlock>
          <SourceNote>getBottlePlan · getMaltodextrinFraction · generateTimingTimeline</SourceNote>
        </MethodologyCard>

        <MethodologyCard number="06 ·" title="Recuperación bifásica post-ruta">
          <p>
            La resíntesis de glucógeno no es uniforme durante la ventana de recuperación: los
            primeros 30-45 minutos son la única franja donde la captación de glucosa muscular
            ocurre mayormente por translocación de GLUT-4 inducida por el ejercicio (independiente
            de insulina), así que una fuente líquida rápida aprovecha esa ventana antes de que se
            cierre.
          </p>
          <EquationBlock>
            Fase 1 (0-45 min): 35% de la deuda neta de carbohidratos, en líquido de absorción
            rápida
            <br />
            Fase 2 (1.5-2 h): 65% restante + comida sólida completa
            <br />
            Proteína: 0.35 g/kg (acotado 22-35g) · Grasa límite: 0.15 g/kg (acotado 10-20g)
            <br />
            Rehidratación objetivo: 120% del déficit de líquido real (no un 1:1)
          </EquationBlock>
          <p>
            La deuda neta se calcula siempre contra lo que el ciclista dice haber consumido{" "}
            <em>durante</em> la ruta (bidones, geles, sales) — replicar más de lo realmente
            quemado no acelera la resíntesis, solo añade calorías de más. La proteína y el límite
            de grasa, en cambio, no dependen de la ingesta en ruta: son sobre reparación muscular y
            velocidad de vaciado gástrico, no sobre reponer un déficit medido.
          </p>
          <SourceNote>getRecoveryDebt · getMacroRecoveryTarget · getBiphasicRecoveryTarget</SourceNote>
        </MethodologyCard>
      </div>

      <p className="max-w-2xl text-xs leading-relaxed text-zinc-400">
        Todas las constantes de esta página se actualizan si el motor cambia — si ves un número
        distinto en el planificador, el motor (
        <code className="font-mono">lib/metabolic-engine.ts</code>) es siempre la fuente de
        verdad, no esta página.
      </p>
    </div>
  );
}
