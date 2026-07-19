import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/** Components that "spin with the wheel" — everything else (chain,
 * chainring) lives at the frame level and wears regardless of which
 * wheelset is mounted. `rim_pad`/`wheel_rim` aren't seeded on the Addict 30
 * (disc brakes) but are included for the same forward-compat reason as
 * elsewhere in the wear model — a future rim-brake wheelset is a data
 * change, not a code change. */
export const WHEEL_COMPONENT_TYPES = new Set([
  "tire_front",
  "tire_rear",
  "cassette",
  "disc_pad",
  "disc_rotor",
  "rim_pad",
  "wheel_rim",
]);

export type Wheelset = {
  id: string;
  name: string;
  is_active: boolean;
};

/** Generic starting point for a brand-new wheelset's components — the same
 * `max_km` baselines `scripts/seed.ts` uses for the original kit, since
 * there's no real product data for a kit the user just created. `tier` is
 * left `null` (unknown brand/tier), which is a neutral 1x modifier
 * everywhere `getEffectiveMaxKm` is used. */
const NEW_WHEELSET_COMPONENTS: { type: string; name: string; max_km: number }[] = [
  { type: "tire_front", name: "Neumático delantero", max_km: 4500 },
  { type: "tire_rear", name: "Neumático trasero", max_km: 4500 },
  { type: "cassette", name: "Cassette", max_km: 7500 },
  { type: "disc_pad", name: "Pastillas de freno", max_km: 2500 },
  { type: "disc_rotor", name: "Disco de freno", max_km: 12000 },
];

/**
 * Lazy graceful upgrade, run on read: the first time a bike with zero
 * wheelsets is encountered, creates a "Kit por Defecto (Original)" wheelset
 * marked active and reassigns every existing wheel-type component to it —
 * frame-level parts (chain, chainring) are left untouched at
 * `wheelset_id: null`. A no-op (one cheap SELECT) on every call after the
 * bike has at least one wheelset, so this is safe to call on every
 * Dashboard load and every Strava sync.
 */
/**
 * Returns `true` when it actually created the default wheelset and
 * backfilled components (so the caller knows any previously-fetched
 * component rows are now stale and worth re-reading), `false` on the
 * common no-op path where the bike already has at least one wheelset.
 */
export async function ensureDefaultWheelset(
  supabase: SupabaseClient,
  bikeId: string
): Promise<boolean> {
  const { data: existing, error: existingError } = await supabase
    .from("wheelsets")
    .select("id")
    .eq("bike_id", bikeId)
    .limit(1);
  if (existingError) throw existingError;
  if (existing && existing.length > 0) return false;

  const { data: created, error: createError } = await supabase
    .from("wheelsets")
    .insert({ bike_id: bikeId, name: "Kit por Defecto (Original)", is_active: true })
    .select("id")
    .single();
  if (createError) throw createError;

  const { data: components, error: componentsError } = await supabase
    .from("components")
    .select("id, type")
    .eq("bike_id", bikeId)
    .is("wheelset_id", null);
  if (componentsError) throw componentsError;

  const wheelComponentIds = (components ?? [])
    .filter((c) => WHEEL_COMPONENT_TYPES.has(c.type))
    .map((c) => c.id);
  if (wheelComponentIds.length === 0) return true;

  const { error: backfillError } = await supabase
    .from("components")
    .update({ wheelset_id: created.id })
    .in("id", wheelComponentIds);
  if (backfillError) throw backfillError;

  return true;
}

export async function getWheelsets(
  supabase: SupabaseClient,
  bikeId: string
): Promise<Wheelset[]> {
  const { data, error } = await supabase
    .from("wheelsets")
    .select("id, name, is_active")
    .eq("bike_id", bikeId)
    .order("name", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Deactivates every other wheelset on the same bike before activating the
 * target one — two sequential UPDATEs (not a single transaction, matching
 * every other multi-step write in this codebase), so a mid-way failure can
 * leave the bike briefly with zero active wheelsets rather than two active
 * ones, which is the safer failure mode for the wear model's zero-wear gate.
 * Returns `false` (rather than throwing) when the final activation UPDATE
 * matches zero rows — not-found id or RLS block — so the caller can surface
 * that as a normal redirect error like every other route in this app.
 */
export async function activateWheelset(
  supabase: SupabaseClient,
  bikeId: string,
  wheelsetId: string
): Promise<boolean> {
  const { error: deactivateError } = await supabase
    .from("wheelsets")
    .update({ is_active: false })
    .eq("bike_id", bikeId);
  if (deactivateError) throw deactivateError;

  const { data: activated, error: activateError } = await supabase
    .from("wheelsets")
    .update({ is_active: true })
    .eq("id", wheelsetId)
    .select("id")
    .maybeSingle();
  if (activateError) throw activateError;
  return activated != null;
}

/**
 * Creates a new wheelset (inactive by default — creating a kit is separate
 * from mounting it) and initializes its 5 wheel-type components at 0 km /
 * `'estimated'`, ready for the user to calibrate or just start riding on.
 */
export async function createWheelset(
  supabase: SupabaseClient,
  bikeId: string,
  name: string
): Promise<Wheelset> {
  const { data: created, error: createError } = await supabase
    .from("wheelsets")
    .insert({ bike_id: bikeId, name, is_active: false })
    .select("id, name, is_active")
    .single();
  if (createError) throw createError;

  const { error: componentsError } = await supabase.from("components").insert(
    NEW_WHEELSET_COMPONENTS.map((component) => ({
      bike_id: bikeId,
      wheelset_id: created.id,
      type: component.type,
      name: component.name,
      max_km: component.max_km,
      current_wear_percentage: 0,
      status_type: "estimated",
    }))
  );
  if (componentsError) throw componentsError;

  return created;
}
