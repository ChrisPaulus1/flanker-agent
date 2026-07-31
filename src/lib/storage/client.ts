import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "@/lib/config";

let cached: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Server-side only — this key bypasses RLS and
 * must never reach the browser, so nothing here is prefixed NEXT_PUBLIC_.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}
