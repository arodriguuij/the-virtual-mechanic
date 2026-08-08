// "Algoritmo Metabólico de Cálculo Calórico Riguroso" — a standalone,
// pure (no I/O, no Supabase/Strava reads of its own — the caller passes in
// whatever real weight/FTP/GPX figures it already has on hand) energy-
// expenditure estimate for a planned ride. Distinct from Post-Ride
// Analysis's own `energySource`/`kilojoules`/`calories` figures
// (`app/api/post-ride/analysis/route.ts`), which read real Strava sensor
// data for a *completed* ride — this is a *pre-ride* estimate with no
// sensor data to fall back on at all, built from the same "heuristic, not
// clinical" convention as `lib/metabolic-engine.ts`: mainstream
// sports-science approximations (a Gross Mechanical Efficiency of ~21.5%,
// i.e. dividing mechanical work by 0.215 ≈ multiplying by 1.11, and the
// standard "roughly 1 kcal per kJ of mechanical work at that efficiency"
// shortcut), not an individually calibrated model.

export type IntensityZone = "Z1" | "Z2" | "Z3" | "Z4";

export interface EnergyInputs {
  /** Peso real del ciclista (kg) — desde `athlete_profiles.weight_kg`. */
  weightKg: number;
  /** Peso de la bici (kg, típicamente ~9.0 para una de carretera — mismo
   * valor que `ESTIMATED_BIKE_WEIGHT_KG` en `lib/metabolic-engine.ts`, ya
   * que no hay un campo real por atleta todavía). Aceptado en la firma para
   * paridad con el algoritmo especificado y para que un futuro modelado de
   * inercia bici+ciclista en subida no necesite romper esta interfaz — el
   * cálculo de vatios en sí, tal como está especificado, no lo usa
   * todavía. */
  bikeWeightKg?: number;
  /** FTP real del atleta (W), si `athlete_profiles.ftp` está configurado. */
  ftpWatts?: number;
  intensityZone: IntensityZone;
  /** Duración estimada de la ruta (h). */
  durationHours: number;
  /** Desnivel positivo real de la ruta/GPX (m) — ahora usado para estimar
   * cuánto tiempo de la ruta transcurre en descenso (ver
   * `estimatedDescentHours` más abajo), no para una corrección de
   * pendiente sobre la potencia objetivo. */
  elevationGainMeters: number;
  /** Distancia real de la ruta/GPX (km). Aceptada en la firma para
   * paridad con el algoritmo especificado y por si un futuro modelado de
   * pendiente media vuelve a necesitarla — "Corrección del Motor
   * Calórico para Rutas de Montaña GPX" eliminó la corrección por
   * pendiente que antes la consumía (ver el aviso de ese cambio más
   * abajo), así que el cálculo en sí ya no la lee. */
  distanceKm: number;
}

export interface RideEnergyExpenditure {
  /** Gasto calórico total estimado para toda la ruta (kcal). */
  totalKcal: number;
  /** Gasto calórico medio por hora (kcal/h). */
  hourlyKcal: number;
  /** Potencia media estimada, tras la corrección por desnivel (W). */
  estimatedWatts: number;
}

/** Fracción de FTP que representa cada zona de intensidad — Z1
 * (Recuperación) hasta Z4 (Umbral/Competición). Usado en el "Método A"
 * cuando el atleta tiene un FTP real configurado. */
const ZONE_FTP_MULTIPLIERS: Record<IntensityZone, number> = {
  Z1: 0.55,
  Z2: 0.68,
  Z3: 0.83,
  Z4: 0.98,
};

/** W/kg típicos por zona, usados solo en el "Método B" — un atleta sin FTP
 * configurado no tiene ningún dato de potencia real del que partir, así que
 * esto es una aproximación poblacional, no una medida personal. */
const ZONE_BASE_WKG: Record<IntensityZone, number> = {
  Z1: 1.8,
  Z2: 2.5,
  Z3: 3.2,
  Z4: 3.9,
};

/** "Corrección del Motor Calórico para Rutas de Montaña GPX" — horas de
 * descenso estimadas por cada 1000m de desnivel positivo real. Una ruta de
 * montaña gana y pierde elevación en cantidades similares (loop o
 * out-and-back), así que el D+ real es un proxy razonable de cuánto
 * descenso técnico/rápido tiene la ruta — tiempo que el ciclista pasa
 * mayormente dejando rodar la bici, no pedaleando a la potencia objetivo
 * de su zona. */
const DESCENT_HOURS_PER_1000M_GAIN = 0.25;
/** Tope máximo de la ruta que puede considerarse "en descenso" — evita que
 * un desnivel extremo sobre una ruta corta le reste más tiempo activo del
 * que tiene sentido físico. */
const MAX_DESCENT_TIME_FRACTION = 0.4;
/** Mínimo de horas "pedaleando activamente" (subida/llano a la potencia
 * objetivo) que se le reconoce a cualquier ruta, por muy montañosa que
 * sea — nunca cero, ya que ninguna ruta real es 100% descenso. */
const MIN_ACTIVE_PEDALING_HOURS = 0.5;
/** Potencia media durante el descenso — inercia y cadencia suave, no un
 * esfuerzo activo a la potencia de la zona elegida. Reemplaza la antigua
 * corrección por pendiente (que *incrementaba* la potencia objetivo en
 * cualquier ruta con desnivel, incluso durante los tramos llanos/de subida
 * ya cubiertos por la zona de intensidad) por un descuento real allí donde
 * el desnivel realmente reduce el esfuerzo medio: las bajadas. */
const DESCENT_COAST_WATTS = 30;

/** Eficiencia mecánica bruta (Gross Mechanical Efficiency) típica en
 * ciclismo (~21.5%) — convertida a factor multiplicador (1 / 0.215 ≈ 1.11)
 * para pasar de trabajo mecánico (kJ) a gasto metabólico real (kcal). */
const METABOLIC_EFFICIENCY_FACTOR = 1.11;

/**
 * Estima el gasto calórico de una ruta planificada a partir del FTP real
 * del atleta (si existe) o, en su defecto, de un modelado W/kg estándar
 * por zona de intensidad, ponderando la potencia objetivo por el tiempo
 * real de pedaleo activo (subida/llano) frente al tiempo estimado de
 * descenso — no aplicando una corrección por pendiente que subía la
 * potencia objetivo incluso en los tramos que la zona de intensidad ya
 * cubre, lo que sobreestimaba sistemáticamente el gasto en rutas de
 * montaña. Puramente heurístico (mismo aviso que el resto de
 * `lib/metabolic-engine.ts`): útil como estimación de planificación, no
 * como una medida clínica o individualmente calibrada.
 */
export function calculateRideEnergyExpenditure(inputs: EnergyInputs): RideEnergyExpenditure {
  const { weightKg, ftpWatts, intensityZone, durationHours, elevationGainMeters } = inputs;

  const intensityPct = ZONE_FTP_MULTIPLIERS[intensityZone] ?? ZONE_FTP_MULTIPLIERS.Z2;

  // Método A: el atleta tiene un FTP real configurado — la potencia
  // objetivo en subida/llano responde directamente a su propio dato
  // fisiológico, exactamente la zona elegida, sin ningún incremento
  // artificial posterior.
  // Método B (sin FTP): W/kg estándar por zona — nunca fabrica un FTP que
  // el atleta no ha introducido, solo aproxima a partir de su peso real.
  const targetClimbWatts =
    ftpWatts && ftpWatts > 0 ? ftpWatts * intensityPct : weightKg * ZONE_BASE_WKG[intensityZone];

  // Tiempo estimado en descenso a partir del desnivel real del GPX/ruta —
  // acotado a un máximo de `MAX_DESCENT_TIME_FRACTION` de la duración
  // total, para que una ruta extremadamente montañosa no implique más
  // tiempo "de bajada" del que la propia duración permite.
  const estimatedDescentHours = Math.min(
    (elevationGainMeters / 1000) * DESCENT_HOURS_PER_1000M_GAIN,
    durationHours * MAX_DESCENT_TIME_FRACTION
  );
  const activePedalingHours = Math.max(durationHours - estimatedDescentHours, MIN_ACTIVE_PEDALING_HOURS);

  // Potencia media real de toda la salida: la potencia objetivo durante el
  // tiempo de pedaleo activo, más una potencia mínima de inercia durante
  // el descenso — no la potencia objetivo sola durante toda la ruta.
  const averagePowerWatts =
    durationHours > 0
      ? (targetClimbWatts * activePedalingHours + DESCENT_COAST_WATTS * estimatedDescentHours) / durationHours
      : 0;

  // Conversión de trabajo mecánico (kJ) a gasto metabólico real (kcal) vía
  // la eficiencia bruta típica del ciclismo.
  const totalMechanicalKJ = (averagePowerWatts * (durationHours * 3600)) / 1000;
  const totalKcal = Math.round(totalMechanicalKJ * METABOLIC_EFFICIENCY_FACTOR);
  const hourlyKcal = durationHours > 0 ? Math.round(totalKcal / durationHours) : 0;

  return {
    totalKcal,
    hourlyKcal,
    estimatedWatts: Math.round(averagePowerWatts),
  };
}
