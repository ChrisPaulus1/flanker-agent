import type { AppRelease } from "@/lib/sources/itunes";
import type { HnReaction } from "@/lib/sources/hn";
import type { TrackedApp } from "@/lib/storage/types";

/**
 * The triage prompt.
 *
 * Three things it works hard at, all learned from what the real data looks
 * like:
 *
 *  - Most releases are filler. "Bug Fixes and Improvements" is Cash App's
 *    current release note verbatim. The prompt has to make "low signal, nothing
 *    to see here" a comfortable answer, or every bugfix gets inflated into a
 *    strategic threat and the dashboard becomes noise.
 *  - Community reaction is usually absent. Rather than let the model
 *    hallucinate sentiment, absence is stated explicitly and the model is told
 *    to return null.
 *  - A counter-PRD is advice to a specific team. An earlier version hardcoded
 *    its reader as "a product team that builds a consumer FinTech app", so
 *    every output said "our app should ship X" for a company that was never
 *    defined. Across a general App Store catalogue that produces strategy for
 *    a fictional company on every page, so the reader is now an explicit input
 *    and the default output carries no "we" at all.
 */

/** The viewer's own product, when they've told us what they build. */
export interface ViewerContext {
  name: string;
  genre?: string | null;
  developer?: string | null;
}

const SIGNAL_GUIDANCE = `signal_level rubric — be honest, most releases are "low":
  high   — a genuinely new user-facing capability, a new product surface, or a
           pricing/business-model change. Something a product lead would put on
           a slide.
  medium — a meaningful improvement to an existing capability, a notable
           platform/integration change, or a clear expansion of an existing
           feature's scope.
  low    — bug fixes, performance work, copy changes, or release notes so
           generic that no capability can be inferred. "Bug Fixes and
           Improvements" is always low. Marketing fluff with no substance is
           also low, however enthusiastic the wording.`;

const GROUNDING = `Ground every claim in the material above. Where you infer, mark it as an
inference. Never invent metrics, user numbers, or quotes.`;

function analysisFields(counterPrd: string): string {
  return `{
  "headline": "one sentence, what shipped, plain language",
  "signal_level": "high | medium | low",
  "feature_analysis": "what the change most likely does mechanically, and what you are inferring vs. what the notes actually say",
  "strategic_read": "the business goal you infer behind shipping this, and why now",
  "hn_reaction_summary": "2-4 sentences summarising the community reaction, or null if no relevant discussion was supplied",
  "counter_prd": ${counterPrd}
}`;
}

const COUNTER_PRD_SHAPE = `{
    "problem_statement": "the user problem the reader's product should address in response",
    "why_now": "why this is worth acting on in this cycle",
    "proposed_feature": "a concrete, buildable response — not 'investigate' or 'monitor'",
    "success_metric": "one measurable metric with a direction, e.g. 'X up N% in 90 days'"
  }`;

function formatReaction(reaction: HnReaction | null): string {
  if (!reaction || reaction.stories.length === 0) {
    return `No relevant Hacker News discussion was found for this app in the search window.
Set "hn_reaction_summary" to null. Do not speculate about how the community
reacted, and do not substitute general knowledge about this company.`;
  }

  const stories = reaction.stories
    .map((s) => `- "${s.title}" (${s.points} points, ${s.numComments} comments) ${s.hnUrl}`)
    .join("\n");

  const comments =
    reaction.comments.length > 0
      ? reaction.comments.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")
      : "(no comment text available)";

  return `Hacker News stories mentioning this company (past 180 days):
${stories}

Comment excerpts:
${comments}

Note: these threads are about the company generally and are very unlikely to
discuss this specific release. Summarise the sentiment you can actually see and
say plainly if it is unrelated to this release. Do not claim the community
reacted to this update unless the text shows that.`;
}

function subject(app: TrackedApp, release: AppRelease): string {
  const notes = release.releaseNotes?.trim();

  return `APP: ${app.name}
VERSION: ${release.version}
RELEASED: ${release.releaseDate}
APP STORE: ${release.trackViewUrl}

RELEASE NOTES (verbatim):
"""
${notes && notes.length > 0 ? notes : "(the developer published no release notes for this version)"}
"""`;
}

export function buildTriagePrompt({
  app,
  release,
  reaction,
  viewer,
}: {
  app: TrackedApp;
  release: AppRelease;
  reaction: HnReaction | null;
  viewer?: ViewerContext | null;
}): string {
  const body = `${subject(app, release)}

${formatReaction(reaction)}`;

  // ---------------------------------------------------------------------
  // Teardown mode: nobody has told us who is reading, so the output must not
  // address anyone. No "we", no recommendations to an unnamed team.
  // ---------------------------------------------------------------------
  if (!viewer) {
    return `You are a product analyst writing a short public teardown of an App Store
release. You do not represent any company, and you are not advising anyone —
you are explaining, for any reader, what shipped and what it signals.

${body}

YOUR TASK
1. Reverse-engineer what actually shipped. Release notes are marketing copy —
   separate what they state from what you are inferring, and say which is which.
   If the notes are too vague to infer a capability, say so rather than guessing.
2. Infer the strategic goal behind the change: what business outcome does this
   company want, and why would they ship it now?
3. Summarise community reaction from the supplied material only, or null.

Write in the third person about the company being analysed. Do not use "we",
"our", or "us" — you have no product and no team. Do not recommend actions to
anyone, because nobody has told you who is reading.

${SIGNAL_GUIDANCE}

${GROUNDING}

OUTPUT
Return a single JSON object matching exactly this shape, and nothing else.
"counter_prd" must be null: no reader has been identified, so there is nobody
to write a counter-PRD for.

${analysisFields("null")}`;
  }

  // ---------------------------------------------------------------------
  // Counter-PRD mode: the reader has named their own product, so advice can be
  // grounded in a real position instead of a fictional one.
  // ---------------------------------------------------------------------
  const isSelf = viewer.name.trim().toLowerCase() === app.name.trim().toLowerCase();

  const viewerBlock = `THE READER'S PRODUCT
Name: ${viewer.name}${viewer.genre ? `\nCategory: ${viewer.genre}` : ""}${
    viewer.developer ? `\nPublisher: ${viewer.developer}` : ""
  }`;

  const selfNote = isSelf
    ? `
NOTE: the reader's product IS the app being analysed — this is your own release,
not a competitor's. Do not write a competitive response. Instead, treat the
counter-PRD as the natural follow-on work: given what just shipped, what is the
most sensible next increment for this same product?`
    : "";

  return `You are a competitive intelligence analyst. You are analysing another
company's App Store release on behalf of a specific reader, and drafting a
concrete response for that reader's product.

${body}

${viewerBlock}${selfNote}

YOUR TASK
1. Reverse-engineer what actually shipped. Release notes are marketing copy —
   separate what they state from what you are inferring, and say which is which.
   If the notes are too vague to infer a capability, say so rather than guessing.
2. Infer the strategic goal behind the change: what business outcome does the
   analysed company want, and why would they ship it now?
3. Summarise community reaction from the supplied material only, or null.
4. Draft a one-page counter-PRD for ${viewer.name} specifically. Write it from
   ${viewer.name}'s position — refer to their product by name, and take their
   actual category into account. The proposed feature must be concrete enough
   to hand to an engineer. "Monitor the situation" and "conduct user research"
   are not acceptable proposals — if the release genuinely does not warrant a
   response, say that in the problem statement and still propose the smallest
   sensible defensive action.

Keep the two products distinct. Steps 1-3 are about ${app.name}. Step 4 is
about ${viewer.name}. Do not write the counter-PRD for ${app.name}.

${SIGNAL_GUIDANCE}

${GROUNDING}

OUTPUT
Return a single JSON object matching exactly this shape, and nothing else:

${analysisFields(COUNTER_PRD_SHAPE)}`;
}
