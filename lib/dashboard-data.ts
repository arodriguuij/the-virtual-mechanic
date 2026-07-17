import "server-only";

import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type BikeWithComponents = {
  id: string;
  brand: string;
  model: string;
  weight: number | null;
  components: {
    id: string;
    name: string;
    type: string;
    max_km: number;
    current_wear_percentage: number;
  }[];
};

export type Activity = {
  id: string;
  name: string;
  distance: number; // metros
  total_elevation_gain: number | null;
  moving_time: number; // segundos
  average_watts: number | null;
  rain_mm: number;
  humidity_avg: number;
  watts_lost: number;
  activity_date: string;
};

/**
 * Module-level singleton: sign in once per server process and let the SDK's
 * built-in token refresh keep the session alive, instead of calling
 * signInWithPassword on every request. `app/page.tsx` is `force-dynamic`, so
 * one sign-in per request used to blow through Supabase Auth's rate limit
 * within seconds. Swap this whole file for the real logged-in user's session
 * once Auth.js lands.
 */
let clientPromise: Promise<SupabaseClient> | null = null;

function getAuthenticatedClient(): Promise<SupabaseClient> {
  if (!clientPromise) {
    clientPromise = (async () => {
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
          "Faltan SEED_USER_EMAIL o SEED_USER_PASSWORD en .env.local (necesarias mientras no exista login con Auth.js)"
        );
      }

      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: seedEmail,
        password: seedPassword,
      });
      if (signInError) {
        throw new Error(
          `No se pudo autenticar con el usuario temporal de desarrollo: ${signInError.message}`
        );
      }

      return supabase;
    })();

    // Don't cache a failed sign-in forever — let the next call retry.
    clientPromise.catch(() => {
      clientPromise = null;
    });
  }

  return clientPromise;
}

export const getPrimaryBike = cache(async (): Promise<BikeWithComponents | null> => {
  const supabase = await getAuthenticatedClient();

  const { data, error } = await supabase
    .from("bikes")
    .select(
      "id, brand, model, weight, components(id, name, type, max_km, current_wear_percentage)"
    )
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
});

export const getLatestActivity = cache(async (): Promise<Activity | null> => {
  const supabase = await getAuthenticatedClient();

  const { data, error } = await supabase
    .from("activities")
    .select(
      "id, name, distance, total_elevation_gain, moving_time, average_watts, rain_mm, humidity_avg, watts_lost, activity_date"
    )
    .order("activity_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
});
