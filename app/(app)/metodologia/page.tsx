import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

// "Base Científica" — a public-facing article on the sports-nutrition and
// exercise-physiology principles behind RATIO's fueling recommendations,
// written as a standalone piece of nutrition science literature rather than
// documentation of this app's own internals. No file paths, function names,
// or implementation details — an athlete (or a curious non-technical
// reader) should be able to read this end to end without ever learning this
// is a web app at all. Static content, no data fetch — a plain Server
// Component like `/privacidad`.

const eyebrow = "font-mono text-xs font-semibold tracking-wider text-zinc-500 uppercase";

function EquationBlock({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg bg-[#F8F7F5] p-3 font-mono text-xs leading-relaxed text-zinc-800 sm:text-sm">
      {children}
    </div>
  );
}

function Citation({ children }: { children: ReactNode }) {
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
    // "Unificación de Fondo Porcelana entre Rutas" — see `/`'s own root
    // wrapper (`app/(app)/page.tsx`) for why this explicit background
    // sits on the page's own root now, on top of `<body>`'s existing
    // `bg-background` (the same value).
    <div className="min-h-dvh w-full flex flex-col gap-6 bg-[#F8F7F5]">
      <header>
        {/* "Normalización Tipográfica" — sentence case, no `uppercase`
            transform, matching the same de-shouting pass already applied to
            the tabs/card titles/field labels elsewhere in the app. Scoped
            to this page's own `<h1>` string, not Historial/Estadísticas,
            which still share this exact literal class and weren't named. */}
        <h1 className="text-xl font-bold font-mono text-neutral-900 tracking-tight sm:text-2xl">
          Base científica
        </h1>
        <p className="mt-1 text-xs font-mono leading-relaxed text-neutral-500">
          Los principios de fisiología del ejercicio y nutrición deportiva detrás de cada
          recomendación de avituallamiento.
        </p>
      </header>

      <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
        RATIO no es una tabla de nutrición deportiva genérica: cada recomendación que ves en el
        planificador se apoya en principios establecidos de fisiología del ejercicio y nutrición
        deportiva — heurísticos y documentados, <strong>no</strong> un modelo clínico ni
        individualmente calibrado con un test de laboratorio real (VO2 Max, test de sudor,
        curva de lactato). Esta página explica el razonamiento fisiológico detrás de cada cifra.
      </p>

      <div className="flex flex-col gap-4">
        <MethodologyCard number="01 ·" title="Modelo energético y dinámica de glucógeno" defaultOpen>
          <p>
            El coste metabólico de pedalear es directamente proporcional al trabajo mecánico
            realizado. Con una eficiencia de conversión (gross efficiency) del ciclista situada
            habitualmente entre el 20 y el 25%, el gasto calórico total puede aproximarse a
            partir de la potencia media sostenida:
          </p>
          <EquationBlock>Gasto calórico (kcal/h) ≈ Potencia media (W) × 3.6</EquationBlock>
          <p>
            De ese gasto total, la proporción que se cubre con carbohidratos frente a grasas
            depende de la intensidad relativa (%FTP). A ritmos suaves, el organismo prioriza la
            oxidación de ácidos grasos; a medida que la intensidad sube hacia el umbral, la
            demanda de ATP se acelera más deprisa de lo que la vía oxidativa de grasas puede
            responder:
          </p>
          <EquationBlock>
            &lt;50% FTP → ~30 g/h · &lt;65% → ~45 g/h · &lt;80% → ~60 g/h
            <br />
            &lt;95% → ~75 g/h · &lt;110% → ~90 g/h · ≥110% → ~100 g/h (techo de oxidación)
          </EquationBlock>
          <p>
            <strong>Dinámica de glucógeno y retardo gástrico.</strong> La reserva de glucógeno no
            varía de forma instantánea al ingerir un alimento: existe un retardo fisiológico por
            vaciado gástrico y transporte intestinal donde el pico de absorción plasmática ocurre
            aproximadamente a los <strong>25 minutos post-ingesta</strong>:
          </p>
          <EquationBlock>
            Glucógeno(t) = Glucógeno_inicial − ∫ Gasto(t) dt + ∫ Absorción(t − 25 min) dt
          </EquationBlock>
          <p>
            <strong>Fenotipo metabólico (VLaMax).</strong> La tasa máxima de producción de
            lactato (VLaMax) modifica el gasto de glucógeno por debajo del 80% FTP:
          </p>
          <EquationBlock>
            Ajuste por fenotipo: Diésel ×0.85 · Equilibrado ×1.00 · Explosivo ×1.15
          </EquationBlock>
          <Citation>
            Cf. Jeukendrup &amp; Wallis (2005) sobre oxidación de sustrato; Coyle et al. (1991)
            sobre depleción de glucógeno y cinética de absorción gástrica.
          </Citation>
        </MethodologyCard>

        <MethodologyCard number="02 ·" title="Capacidad digestiva: SGLT1 vs GLUT5 (Modo Estándar vs Avanzado)">
          <p>
            El epitelio intestinal cuenta con transportadores especializados con capacidad limitada:
          </p>
          <p>
            <strong>1. Modo Estándar (SGLT1 saturado a 60 g/h).</strong> Utiliza exclusivamente
            el transportador acoplado a sodio SGLT1 (glucosa/maltodextrina). Superar los 60 g/h
            sin fructosa provoca acumulación de solutos en la luz intestinal, tracción osmótica de
            agua y malestar gástrico.
          </p>
          <p>
            <strong>2. Modo Avanzado (Co-transporte SGLT1 + GLUT5 hasta 90-120 g/h).</strong>
            Al reclutar la vía pasiva GLUT5 mediante fructosa en ratios duales (2:1 a 1:0.8 /
            1.2:1), se evita la saturación de SGLT1 y se eleva el techo de absorción hasta 90-120
            g/h en atletas con <em>Gut Training</em>.
          </p>
          <EquationBlock>
            Estándar (SGLT1 solo) → Máximo 60 g/h (100% maltodextrina/glucosa)
            <br />
            Avanzado (SGLT1 + GLUT5) → 90-120 g/h (ratio 2:1 a ~1.2:1 / 1:0.8)
          </EquationBlock>
          <Citation>
            Cf. Jeukendrup (2010) sobre carbohidratos múltiples transportables; Jentjens &amp;
            Jeukendrup (2005) sobre co-transporte glucosa:fructosa.
          </Citation>
        </MethodologyCard>

        <MethodologyCard number="03 ·" title="Termorregulación, electrolitos y frecuencia hídrica">
          <p>
            El impacto térmico condiciona tanto el volumen hídrico como la concentración de sales:
          </p>
          <p>
            <strong>1. Mix Estándar vs Mix Calor:</strong>
          </p>
          <EquationBlock>
            Clima Templado (&lt;25°C): Mix Estándar → ~2.0g sales / 550ml (~500mg Na+)
            <br />
            Clima Cálido (≥25°C o alta sudoración): Mix Calor → ~4.5g sales / 550ml (~1100mg Na+)
          </EquationBlock>
          <p>
            <strong>2. Aceleración del trago hídrico.</strong> En condiciones de calor (≥25°C),
            la frecuencia recomendada de trago se acelera hasta los <strong>12 minutos</strong> por
            dosis para mantener un flujo hídrico continuo y evitar la deshidratación aguda sin
            sobrecargar el estómago.
          </p>
          <Citation>
            Cf. Sawka et al. (2007), ACSM Position Stand sobre reposición hídrica en calor; Baker
            (2017) sobre variabilidad en sodio.
          </Citation>
        </MethodologyCard>

        <MethodologyCard number="04 ·" title="Reglas tácticas en ruta y análisis GPX">
          <p>
            El planificador táctico aplica reglas de oportunidad metabólica según el trazado GPX:
          </p>
          <p>
            <strong>1. Anticipación Pre-Puerto.</strong> Las tomas de carbohidratos de rápida
            absorción se programan <strong>10 a 15 minutos antes</strong> del inicio de ascensos
            significativos (&gt;4% de pendiente). Si la transición entre dos puertos consecutivos es
            inferior a <strong>5 minutos</strong>, la toma se unifica previamente al primer puerto.
          </p>
          <p>
            <strong>2. Bloqueo en Bajadas (Descensos &lt;-3%).</strong> Se inhibe la alerta de
            ingesta de alimentos sólidos en tramos con pendientes descendentemente pronunciadas
            (&lt;-3%) por motivos de seguridad técnica y por la reducción del riego sanguíneo
            esplácnico durante maniobras de alta velocidad.
          </p>
          <EquationBlock>
            Pre-Puerto (&gt;4%): Toma programada 10-15 min antes (Transición &lt;5 min → Unificada)
            <br />
            Descensos (&lt;-3%): Inserción de sólidos inhibida por seguridad y flujo vascular
          </EquationBlock>
          <Citation>
            Cf. Pfeiffer et al. (2012) sobre nutrición en competición y factores de seguridad
            táctica en ruta.
          </Citation>
        </MethodologyCard>

        <MethodologyCard number="05 ·" title="Balance hídrico y reposición de sodio">
          <EquationBlock>
            Tasa de sudoración base (ml/h): Baja ~500 · Media ~750 · Alta ~1000
            <br />
            Sodio (mg/h) = (Tasa de sudoración (ml/h) / 1000) × Concentración de sodio en sudor
            (mg/L)
            <br />
            Rango de concentración habitual: 400-1500 mg/L
          </EquationBlock>
          <p>
            La concentración de sodio en el sudor varía enormemente entre individuos — mucho más
            que el volumen de sudor en sí — y es en gran parte genética, no entrenable. Un
            &quot;sudador salado&quot; (reconocible por cercos blancos de sal cristalizada en el
            maillot o escozor en los ojos durante el esfuerzo) puede perder sodio a una
            concentración muy superior a la media, y reponerlo con una bebida isotónica genérica
            calculada para un sudador típico deja un déficit acumulativo real en salidas largas.
          </p>
          <p>
            Infra-dosificar sodio en un sudador salado real, especialmente en salidas largas y
            calurosas con alto volumen de agua ingerida, es uno de los factores de riesgo
            conocidos de hiponatremia dilucional inducida por el ejercicio — una condición poco
            frecuente pero potencialmente grave, en la que el sodio plasmático se diluye por
            debajo de niveles seguros.
          </p>
          <Citation>
            Cf. Baker (2017) sobre variabilidad individual en la concentración de sodio en
            sudor; Hew-Butler et al. (2015), consenso internacional sobre hiponatremia asociada
            al ejercicio.
          </Citation>
        </MethodologyCard>

        <MethodologyCard number="06 ·" title="Formulación de mezcla casera e ingesta en ruta">
          <p>
            Una bebida de bidón no puede concentrarse indefinidamente para ahorrar volumen: por
            encima de cierta concentración de carbohidrato, la solución se vuelve hipertónica
            respecto al plasma sanguíneo, lo que ralentiza el vaciado gástrico y puede arrastrar
            agua hacia la luz intestinal por ósmosis en lugar de facilitar su absorción —
            exactamente el efecto contrario al buscado en una bebida de rendimiento.
          </p>
          <EquationBlock>
            Concentración máxima recomendada por bidón ≈ 8% del volumen (margen de seguridad
            bajo el 10-12% citado como umbral de malestar gástrico)
            <br />
            Límite de solubilidad práctico ≈ 140 g de polvo por litro de agua fría
          </EquationBlock>
          <p>
            La dosis base de referencia — <strong>24g de maltodextrina + 20g de fructosa + 1.0g
            de sal común, disueltos en 550ml de agua</strong> — se sitúa deliberadamente en torno
            al 8% de concentración de carbohidrato, cómodamente por debajo del umbral de
            malestar gástrico y del límite físico de solubilidad, y se escala de forma
            proporcional al tamaño real del bidón del ciclista.
          </p>
          <p>
            <strong>Sincronización de la cafeína.</strong> La cafeína alcanza su pico de
            concentración plasmática entre 30 y 60 minutos después de la ingesta oral, con un
            efecto ergogénico bien documentado sobre la percepción del esfuerzo y el
            reclutamiento neuromuscular en la última fase de un esfuerzo prolongado. Anclar la
            toma unos 45 minutos antes del tramo más exigente de la ruta — un puerto tardío, o el
            tramo final si el trazado es llano — maximiza la concentración plasmática justo
            cuando más se necesita, en lugar de desperdiciar el pico en un momento de la ruta sin
            demanda especial.
          </p>
          <Citation>
            Cf. Jeukendrup (2004) sobre el modelo de dosificación de carbohidratos en bebidas
            deportivas; Cook &amp; Beaven (2013) sobre timing de cafeína y rendimiento en
            resistencia.
          </Citation>
        </MethodologyCard>

        <MethodologyCard number="07 ·" title="Recuperación bifásica post-ruta">
          <p>
            La resíntesis de glucógeno muscular no ocurre a un ritmo constante durante toda la
            ventana de recuperación. Los primeros 30-45 minutos tras el esfuerzo son una franja
            fisiológicamente especial: la captación de glucosa por el músculo ocurre en gran
            parte por translocación de transportadores GLUT-4 inducida directamente por la
            contracción muscular, un mecanismo independiente de la insulina y mucho más eficiente
            que en reposo. Aprovechar esa ventana con una fuente de carbohidrato líquida de
            absorción rápida acelera el inicio de la resíntesis antes de que ese mecanismo se
            atenúe.
          </p>
          <EquationBlock>
            Fase 1 (0-45 min): ~35% de la deuda de carbohidratos, en formato líquido de absorción
            rápida
            <br />
            Fase 2 (1.5-2 h): ~65% restante, en comida sólida completa + proteína
            <br />
            Proteína: ~0.35 g/kg de peso corporal · Grasa (límite orientativo): ~0.15 g/kg
            <br />
            Objetivo de rehidratación: ~150% del déficit de líquido estimado, no una reposición
            1:1
          </EquationBlock>
          <p>
            La sobrehidratación deliberada (por encima del volumen exacto perdido) compensa las
            pérdidas continuadas por sudoración y micción que persisten incluso después de parar
            de pedalear — reponer solo el volumen exacto perdido durante el esfuerzo, sin ese
            margen, deja al ciclista en un déficit hídrico neto varias horas después de terminar.
            La proteína y el límite de grasa en la ventana de recuperación, por su parte, no
            dependen de cuánto se haya comido ya en ruta: responden a la reparación del tejido
            muscular y a mantener un vaciado gástrico ágil, no a reponer un déficit calórico
            medido.
          </p>
          <Citation>
            Cf. Ivy &amp; Kuo (1998) sobre el papel de GLUT-4 en la resíntesis post-ejercicio;
            Beelen et al. (2010) sobre estrategias de recuperación nutricional en ciclismo;
            Shirreffs &amp; Sawka (2011) sobre rehidratación post-ejercicio.
          </Citation>
        </MethodologyCard>
      </div>

      <p className="max-w-2xl text-xs leading-relaxed text-zinc-400">
        Los umbrales y proporciones citados aquí son heurísticos habituales de la literatura de
        nutrición deportiva, no un protocolo clínico individualizado — la referencia real para
        cualquier decisión sobre tu propia fisiología sigue siendo un test de laboratorio
        (sudor, lactato, VO2 Max) o la orientación de un profesional cualificado.
      </p>
    </div>
  );
}
