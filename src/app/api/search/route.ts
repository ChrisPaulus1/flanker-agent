import { NextResponse } from "next/server";
import { SupabaseFlankerRepo } from "@/lib/storage/repo";
import { search, suggest } from "@/lib/catalog/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Catalog search.
 *
 *   /api/search?q=snap            full results
 *   /api/search?q=s&mode=suggest  type-ahead, capped at three
 *
 * Reads Postgres only — no LLM, no upstream API. Type-ahead fires on every
 * keystroke, so anything expensive here would be both slow and a way for one
 * visitor to burn the daily generation budget just by typing.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const mode = searchParams.get("mode");

  try {
    const repo = new SupabaseFlankerRepo();
    const results =
      mode === "suggest" ? await suggest(repo, query) : await search(repo, query);

    return NextResponse.json(
      { query, results },
      {
        headers: {
          // Short shared cache: identical prefixes are hammered while typing,
          // and the catalog only changes when a refresh runs.
          "cache-control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[flanker] search failed: ${message}`);
    // Degrade to an empty result set — a broken dropdown shouldn't take the
    // page down with it.
    return NextResponse.json({ query, results: [], error: message }, { status: 500 });
  }
}
