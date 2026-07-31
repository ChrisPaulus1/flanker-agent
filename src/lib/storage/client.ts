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
    global: {
      // Next.js patches global fetch with a persistent Data Cache, and
      // supabase-js queries are GETs, so they get cached across requests and
      // across invocations. `export const dynamic = "force-dynamic"` on the
      // page does NOT cover this — it controls route rendering, not the Data
      // Cache. Without this the deployed dashboard happily serves rows that
      // have since been deleted, which is exactly what it did in production
      // while looking perfectly fine locally, because dev mode doesn't use
      // the Data Cache.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });

  return cached;
}
