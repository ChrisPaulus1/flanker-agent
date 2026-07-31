import type { AppRelease } from "@/lib/sources/itunes";
import type { HnReaction } from "@/lib/sources/hn";
import type { TrackedApp } from "@/lib/storage/types";

/**
 * The triage prompt.
 *
 * Two things it works hard at, both learned from what the real data looks like:
 *
 *  - Most releases are filler. "Bug Fixes and Improvements" is Cash App's
 *    current release note verbatim. The prompt has to make "low signal, nothing
 *    to see here" a comfortable answer, or every bugfix gets inflated into a
 *    strategic threat and the dashboard becomes noise.
 *  - Community reaction is usually absent. Rather than let the model
 *    hallucinate sentiment, absence is stated explicitly and the model is told
 *    to return null.
 */

const RESPONSE_CONTRACT = `{
  "headline": "one sentence, what shipped, plain language",
  "signal_level": "high | medium | low",
  "feature_analysis": "what the change most likely does mechanically, and what you are inferring vs. what the notes actually say",
  "strategic_read": "the business goal you infer behind shipping this, and why now",
  "hn_reaction_summary": "2-4 sentences summarising the community reaction, or null if no relevant discussion was supplied",
  "counter_prd": {
    "problem_statement": "the user problem our product should address in response",
    "why_now": "why this is worth acting on in this cycle",
    "proposed_feature": "a concrete, buildable response — not 'investigate' or 'monitor'",
    "success_metric": "one measurable metric with a direction, e.g. 'X up N% in 90 days'"
  }
}`;

const SIGNAL_GUIDANCE = `signal_level rubric — be honest, most releases are "low":
  high   — a genuinely new user-facing capability, a new product surface, or a
           pricing/business-model change. Something a competitor PM would put
           on a slide.
  medium — a meaningful improvement to an existing capability, a notable
           platform/integration change, or a clear expansion of an existing
           feature's scope.
  low    — bug fixes, performance work, copy changes, or release notes so
           generic that no capability can be inferred. "Bug Fixes and
           Improvements" is always low. Marketing fluff with no substance is
           also low, however enthusiastic the wording.`;

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

export function buildTriagePrompt({
  app,
  release,
  reaction,
}: {
  app: TrackedApp;
  release: AppRelease;
  reaction: HnReaction | null;
}): string {
  const notes = release.releaseNotes?.trim();

  return `You are a competitive intelligence analyst supporting a product team that
builds a consumer FinTech app. You are analysing a competitor's App Store release.

COMPETITOR: ${app.name}
VERSION: ${release.version}
RELEASED: ${release.releaseDate}
APP STORE: ${release.trackViewUrl}

RELEASE NOTES (verbatim):
"""
${notes && notes.length > 0 ? notes : "(the developer published no release notes for this version)"}
"""

${formatReaction(reaction)}

YOUR TASK
1. Reverse-engineer what actually shipped. Release notes are marketing copy —
   separate what they state from what you are inferring, and say which is which.
   If the notes are too vague to infer a capability, say so rather than guessing.
2. Infer the strategic goal behind the change: what business outcome does this
   competitor want, and why would they ship it now?
3. Summarise community reaction from the supplied material only, or null.
4. Draft a one-page counter-PRD: how should our team respond? The proposed
   feature must be concrete enough to hand to an engineer. "Monitor the
   situation" and "conduct user research" are not acceptable proposals — if the
   release genuinely does not warrant a response, say that in the problem
   statement and still propose the smallest sensible defensive action.

${SIGNAL_GUIDANCE}

Ground every claim in the material above. Where you infer, mark it as an
inference. Never invent metrics, user numbers, or quotes.

OUTPUT
Return a single JSON object matching exactly this shape, and nothing else:

${RESPONSE_CONTRACT}`;
}
