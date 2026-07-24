import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const seedEmail = process.env.SEED_USER_EMAIL;
const seedPassword = process.env.SEED_USER_PASSWORD;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local"
  );
}
if (!seedEmail || !seedPassword) {
  throw new Error(
    "Faltan SEED_USER_EMAIL o SEED_USER_PASSWORD en .env.local (usuario de prueba, ya confirmado por email)"
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const { data: signIn, error: signInError } =
    await supabase.auth.signInWithPassword({
      email: seedEmail!,
      password: seedPassword!,
    });
  if (signInError || !signIn.user) {
    throw new Error(
      `No se pudo iniciar sesión con el usuario de prueba (¿confirmaste el email?): ${signInError?.message}`
    );
  }
  const userId = signIn.user.id;

  const { data: existingProfile, error: profileFetchError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (profileFetchError) throw profileFetchError;

  if (existingProfile) {
    console.log("✓ Perfil ya existía:", existingProfile.id);
  } else {
    const { error: profileInsertError } = await supabase
      .from("profiles")
      .insert({ id: userId, email: seedEmail });
    if (profileInsertError) throw profileInsertError;
    console.log("+ Perfil creado:", userId);
  }

  const { data: existingAthleteProfile, error: athleteProfileFetchError } = await supabase
    .from("athlete_profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (athleteProfileFetchError) throw athleteProfileFetchError;

  if (existingAthleteProfile) {
    console.log("✓ Perfil fisiológico ya existía:", existingAthleteProfile.id);
  } else {
    const { error: athleteProfileInsertError } = await supabase.from("athlete_profiles").insert({
      id: userId,
      ftp: 250,
      weight_kg: 72,
      sweat_rate: "medium",
    });
    if (athleteProfileInsertError) throw athleteProfileInsertError;
    console.log("+ Perfil fisiológico creado:", userId);
  }

  const activityId = "seed-serra-tramuntana-001";
  const { data: existingActivity, error: activityFetchError } = await supabase
    .from("activities")
    .select("id")
    .eq("id", activityId)
    .maybeSingle();
  if (activityFetchError) throw activityFetchError;

  if (existingActivity) {
    console.log("✓ Actividad ya existía:", existingActivity.id);
  } else {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Nutrition figures computed by hand from lib/metabolic-engine.ts's
    // formulas for FTP 250 / 244W avg / 82% humidity / 24°C / medium sweat
    // rate over this ride's 3h24m — a fixed plausible fixture, same
    // convention as the other static fields below, not a live computation.
    const { error: activityInsertError } = await supabase.from("activities").insert({
      id: activityId,
      profile_id: userId,
      name: "Serra de Tramuntana Loop",
      distance: 92_400, // metros
      total_elevation_gain: 1680,
      moving_time: 12_240, // 3h 24m, en segundos
      average_watts: 244,
      rain_mm: 0,
      humidity_avg: 82,
      temperature_avg: 24,
      carbs_burned_g: 306,
      fluid_loss_ml: 3223,
      sodium_loss_mg: 2258,
      activity_date: yesterday,
    });
    if (activityInsertError) throw activityInsertError;
    console.log("+ Actividad creada:", activityId);
  }

  console.log("Seed completado.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
