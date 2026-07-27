"use server";

import { redirect } from "next/navigation";

import { getAuthenticatedSupabaseClient } from "@/lib/supabase-server";

export async function logout() {
  const supabase = await getAuthenticatedSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
