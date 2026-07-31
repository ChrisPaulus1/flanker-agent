/**
 * Environment access.
 *
 * Deliberately fails loud and early with the variable name in the message —
 * a cron job that half-runs because one env var is missing is much harder to
 * diagnose than one that refuses to start.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set it in .env.local locally, or in Project Settings → Environment Variables on Vercel.`,
    );
  }
  return value.trim();
}

export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

export const config = {
  supabase: {
    get url() {
      return requireEnv("SUPABASE_URL");
    },
    get serviceRoleKey() {
      return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
    },
  },
  gemini: {
    get apiKey() {
      return requireEnv("GEMINI_API_KEY");
    },
    /** Empty means "resolve the best available model at runtime". */
    get model() {
      return optionalEnv("GEMINI_MODEL", "");
    },
  },
  email: {
    get apiKey() {
      return requireEnv("RESEND_API_KEY");
    },
    get from() {
      return optionalEnv("ALERT_EMAIL_FROM", "Flanker <onboarding@resend.dev>");
    },
    get to() {
      return requireEnv("ALERT_EMAIL_TO");
    },
  },
  get cronSecret() {
    return requireEnv("CRON_SECRET");
  },
  get baseUrl() {
    // Vercel injects VERCEL_URL without a scheme on every deployment.
    const vercelUrl = process.env.VERCEL_URL;
    if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
    if (vercelUrl) return `https://${vercelUrl}`;
    return "http://localhost:3000";
  },
};
