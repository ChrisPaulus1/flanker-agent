import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-token check for the cron endpoint.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when a
 * CRON_SECRET env var exists on the project, and the GitHub Actions workflow
 * sends the same header, so one check covers both callers.
 *
 * Split out as a pure function so the failure modes — missing header, wrong
 * scheme, empty secret — are unit-testable without standing up a route.
 */
export function isAuthorizedCronRequest(
  authorizationHeader: string | null,
  expectedSecret: string,
): boolean {
  // An empty configured secret must never authorise anything, or a missing
  // env var in production would silently make the endpoint public.
  if (!expectedSecret) return false;
  if (!authorizationHeader) return false;

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(expectedSecret);

  // Length differs => not equal, and timingSafeEqual throws on mismatched
  // lengths, so check first. Length is not the secret.
  if (provided.length !== expected.length) return false;

  return timingSafeEqual(provided, expected);
}
