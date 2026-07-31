/**
 * Live smoke check for the source adapters. Hits the real iTunes and HN APIs —
 * no keys required. Run with `npx tsx scripts/check-sources.ts`.
 *
 * Unit tests cover the parsing contracts against fixtures; this exists to catch
 * the other failure mode, where the upstream API itself changes shape.
 */
import { fetchLatestRelease } from "../src/lib/sources/itunes";
import { fetchReaction } from "../src/lib/sources/hn";
import { SEED_APPS } from "../src/lib/tracked-apps";

async function main() {
  for (const app of SEED_APPS) {
    console.log(`\n=== ${app.name} (${app.itunesTrackId}) ===`);

    const release = await fetchLatestRelease(app.itunesTrackId);
    console.log(`  version : ${release.version}`);
    console.log(`  released: ${release.releaseDate}`);
    console.log(`  notes   : ${(release.releaseNotes ?? "<none>").slice(0, 120).replace(/\n/g, " ")}`);

    const reaction = await fetchReaction(app.hnQuery, { sinceDaysAgo: 180 });
    console.log(`  hn query: ${app.hnQuery}`);
    console.log(`  hn hits : ${reaction.stories.length} stories, ${reaction.comments.length} comments`);
    for (const story of reaction.stories) {
      console.log(`    - [${story.points}pts/${story.numComments}c] ${story.title}`);
    }
    if (reaction.stories.length === 0) {
      console.log("    (no relevant discussion — this is a legitimate result)");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
