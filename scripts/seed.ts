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

  const { data: existingBike, error: bikeFetchError } = await supabase
    .from("bikes")
    .select("id")
    .eq("profile_id", userId)
    .eq("brand", "Scott")
    .eq("model", "Addict 30")
    .maybeSingle();
  if (bikeFetchError) throw bikeFetchError;

  let bikeId: string;
  if (existingBike) {
    console.log("✓ Bici ya existía:", existingBike.id);
    bikeId = existingBike.id;
  } else {
    const { data: newBike, error: bikeInsertError } = await supabase
      .from("bikes")
      .insert({
        profile_id: userId,
        brand: "Scott",
        model: "Addict 30",
        weight: 7.9,
      })
      .select("id")
      .single();
    if (bikeInsertError) throw bikeInsertError;
    console.log("+ Bici creada:", newBike.id);
    bikeId = newBike.id;
  }

  const bikeComponents = [
    {
      type: "chain",
      name: "Cadena Shimano Ultegra 11v",
      brand: "Shimano",
      tier: "Ultegra",
      max_km: 3000,
      current_wear_percentage: 35.0,
    },
    {
      type: "cassette",
      name: "Cassette Shimano Ultegra 11v",
      brand: "Shimano",
      tier: "Ultegra",
      max_km: 7500,
      current_wear_percentage: 20.0,
    },
    {
      type: "chainring",
      name: "Platos Shimano Ultegra 11v",
      brand: "Shimano",
      tier: "Ultegra",
      max_km: 18000,
      current_wear_percentage: 8.0,
    },
    // Braking module — the Addict 30 runs discs, so rim_pad/wheel_rim stay
    // unseeded for now (the wear model already handles them, see
    // lib/wear-model.ts, for whenever a rim-brake bike shows up).
    {
      type: "disc_pad",
      name: "Pastillas de freno Shimano L05A Resin",
      brand: "Shimano",
      tier: "L05A Resin",
      max_km: 2500,
      current_wear_percentage: 10.0,
    },
    {
      type: "disc_rotor",
      name: "Disco de freno Shimano RT-MT800 (Ultegra)",
      brand: "Shimano",
      tier: "RT-MT800 (Ultegra)",
      max_km: 12000,
      current_wear_percentage: 5.0,
    },
  ];

  for (const component of bikeComponents) {
    const { data: existingComponent, error: componentFetchError } = await supabase
      .from("components")
      .select("id")
      .eq("bike_id", bikeId)
      .eq("type", component.type)
      .maybeSingle();
    if (componentFetchError) throw componentFetchError;

    if (existingComponent) {
      console.log(`✓ ${component.name} ya existía:`, existingComponent.id);
    } else {
      const { error: componentInsertError } = await supabase
        .from("components")
        .insert({ bike_id: bikeId, ...component });
      if (componentInsertError) throw componentInsertError;
      console.log(`+ ${component.name} creado`);
    }
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
      watts_lost: 15,
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
