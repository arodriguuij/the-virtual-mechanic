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
  /** Desnivel positivo real de la ruta/GPX (m). */
  elevationGainMeters: number;
  /** Distancia real de la ruta/GPX (km). */
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

/** Pendiente media (%) a partir de la cual la corrección por desnivel
 * empieza a aplicarse — por debajo de esto el desnivel no representa un
 * esfuerzo adicional significativo sobre la intensidad ya elegida. */
const GRADIENT_CORRECTION_THRESHOLD_PCT = 1.5;
/** Incremento de potencia por cada punto porcentual de pendiente media por
 * encima del umbral anterior. */
const GRADIENT_CORRECTION_FACTOR = 0.04;

/** Eficiencia mecánica bruta (Gross Mechanical Efficiency) típica en
 * ciclismo (~21.5%) — convertida a factor multiplicador (1 / 0.215 ≈ 1.11)
 * para pasar de trabajo mecánico (kJ) a gasto metabólico real (kcal). */
const METABOLIC_EFFICIENCY_FACTOR = 1.11;

/**
 * Estima el gasto calórico de una ruta planificada a partir del FTP real
 * del atleta (si existe) o, en su defecto, de un modelado W/kg estándar
 * por zona de intensidad — corrigiendo el resultado por el desnivel real
 * de la ruta. Puramente heurístico (mismo aviso que el resto de
 * `lib/metabolic-engine.ts`): útil como estimación de planificación, no
 * como una medida clínica o individualmente calibrada.
 */
export function calculateRideEnergyExpenditure(inputs: EnergyInputs): RideEnergyExpenditure {
  const { weightKg, ftpWatts, intensityZone, durationHours, elevationGainMeters, distanceKm } = inputs;

  const intensityPct = ZONE_FTP_MULTIPLIERS[intensityZone] ?? ZONE_FTP_MULTIPLIERS.Z2;

  // Método A: el atleta tiene un FTP real configurado — la estimación de
  // potencia responde directamente a su propio dato fisiológico.
  // Método B (sin FTP): W/kg estándar por zona — nunca fabrica un FTP que
  // el atleta no ha introducido, solo aproxima a partir de su peso real.
  const estimatedWattsBase =
    ftpWatts && ftpWatts > 0 ? ftpWatts * intensityPct : weightKg * ZONE_BASE_WKG[intensityZone];

  // Corrección por desnivel real del GPX/ruta — una pendiente media
  // exigente añade un esfuerzo que la zona de intensidad elegida por sí
  // sola no captura.
  const gradientPct = distanceKm > 0 ? (elevationGainMeters / (distanceKm * 1000)) * 100 : 0;
  const gradientMultiplier =
    gradientPct > GRADIENT_CORRECTION_THRESHOLD_PCT
      ? 1 + (gradientPct - GRADIENT_CORRECTION_THRESHOLD_PCT) * GRADIENT_CORRECTION_FACTOR
      : 1;
  const estimatedWatts = estimatedWattsBase * gradientMultiplier;

  // Conversión de trabajo mecánico (kJ) a gasto metabólico real (kcal) vía
  // la eficiencia bruta típica del ciclismo.
  const totalMechanicalKJ = (estimatedWatts * (durationHours * 3600)) / 1000;
  const totalKcal = Math.round(totalMechanicalKJ * METABOLIC_EFFICIENCY_FACTOR);
  const hourlyKcal = durationHours > 0 ? Math.round(totalKcal / durationHours) : 0;

  return {
    totalKcal,
    hourlyKcal,
    estimatedWatts: Math.round(estimatedWatts),
  };
}
