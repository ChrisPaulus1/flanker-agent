/**
 * Loads .env.local for standalone scripts.
 *
 * Next.js loads .env.local automatically, but tsx scripts don't get that for
 * free, and plain `dotenv/config` only reads `.env`. Import this first in any
 * script that touches a keyed service.
 */
import { config as loadDotenv } from "dotenv";
import path from "node:path";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local") });
// Fall back to .env without overriding anything .env.local already set.
loadDotenv({ path: path.resolve(process.cwd(), ".env") });
