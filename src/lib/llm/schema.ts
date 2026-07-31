import { z } from "zod";

/**
 * The contract Flanker requires back from the LLM.
 *
 * This is the single source of truth for the shape: the prompt is generated
 * from it, the parser validates against it, and the dashboard and email both
 * read the validated type. A model that returns something else is a failed
 * pipeline run, not a half-populated event row.
 */

export const SIGNAL_LEVELS = ["high", "medium", "low"] as const;
export type SignalLevel = (typeof SIGNAL_LEVELS)[number];

/** Release notes are frequently filler, so "low" is the expected common case. */
export const signalLevelSchema = z.enum(SIGNAL_LEVELS);

export const counterPrdSchema = z.object({
  problem_statement: z.string().min(1),
  why_now: z.string().min(1),
  proposed_feature: z.string().min(1),
  success_metric: z.string().min(1),
});

export const llmTriageSchema = z.object({
  /** One line summarising what actually shipped. */
  headline: z.string().min(1),
  signal_level: signalLevelSchema,
  /** Reverse-engineering: what the feature plausibly does, mechanically. */
  feature_analysis: z.string().min(1),
  /** The inferred business goal behind shipping it. */
  strategic_read: z.string().min(1),
  /**
   * Null when no relevant community discussion was found. The model is
   * instructed never to invent reaction, because HN coverage of any specific
   * release is usually genuinely absent.
   */
  hn_reaction_summary: z.string().min(1).nullable(),
  /**
   * Null unless the viewer has told us what they build.
   *
   * A counter-PRD is advice to a specific product team — "our app should ship
   * X". Without knowing who "we" are, that advice is written for a company
   * that doesn't exist, which is worse than no advice. So the default output
   * is a teardown with no counter-PRD, and this is populated only when a
   * viewer context is supplied.
   */
  counter_prd: counterPrdSchema.nullable(),
});

export type CounterPrd = z.infer<typeof counterPrdSchema>;
export type LlmTriage = z.infer<typeof llmTriageSchema>;
