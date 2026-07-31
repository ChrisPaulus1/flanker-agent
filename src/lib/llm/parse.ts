import { llmTriageSchema, type LlmTriage } from "@/lib/llm/schema";

/**
 * Tolerant extraction and strict validation of the model's response.
 *
 * Tolerant on the way in because models wrap JSON in markdown fences, prefix it
 * with "Sure! Here's...", and leave trailing commas — none of which are worth
 * failing a pipeline run over. Strict once parsed, because a half-valid object
 * written to `events.llm_output_json` would surface as a broken dashboard card
 * long after the run that produced it.
 */

/**
 * Pull the JSON object out of a model response.
 *
 * Scans for a balanced object rather than using lastIndexOf("}"), which
 * truncates whenever a string value contains a brace.
 */
export function extractJsonBlock(raw: string): string {
  const text = raw.trim();

  // Prefer a fenced block when present — models sometimes emit an example
  // object in prose alongside the real answer.
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();

  const start = candidate.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON object found in model response");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const char = candidate[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }

  throw new Error("No JSON object found in model response (unbalanced braces)");
}

/** Strip trailing commas before `}` or `]`, which JSON.parse rejects. */
function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, "$1");
}

export function parseTriageResponse(raw: string): LlmTriage {
  const block = extractJsonBlock(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    try {
      parsed = JSON.parse(stripTrailingCommas(block));
    } catch (error) {
      throw new Error(
        `Model response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const result = llmTriageSchema.safeParse(parsed);
  if (!result.success) {
    // Name the offending paths — a bare "validation failed" in a cron log is
    // close to useless when the prompt is the thing that needs fixing.
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Model response failed validation — ${issues}`);
  }

  return result.data;
}
