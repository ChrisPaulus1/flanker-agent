import { describe, expect, it } from "vitest";
import { extractJsonBlock, parseTriageResponse } from "@/lib/llm/parse";

const valid = {
  headline: "Chime ships instant paycheck advances",
  signal_level: "high",
  feature_analysis: "Short-term liquidity product fronting earned wages.",
  strategic_read: "Deepens primary-account behaviour ahead of a bank charter.",
  hn_reaction_summary: null,
  category_implication: "Earned-wage access is becoming table stakes for consumer banking apps.",
  counter_prd: {
    problem_statement: "Users bridge shortfalls with high-cost credit.",
    why_now: "Competitor has set a $500 anchor.",
    proposed_feature: "Earned-wage access tied to direct deposit history.",
    success_metric: "30-day repeat usage among enrolled users.",
  },
};

const json = JSON.stringify(valid, null, 2);

describe("extractJsonBlock", () => {
  it("passes through bare JSON", () => {
    expect(extractJsonBlock(json)).toBe(json);
  });

  it("unwraps a ```json fenced block", () => {
    expect(JSON.parse(extractJsonBlock("```json\n" + json + "\n```"))).toEqual(valid);
  });

  it("unwraps a fenced block with no language tag", () => {
    expect(JSON.parse(extractJsonBlock("```\n" + json + "\n```"))).toEqual(valid);
  });

  it("ignores prose before and after the block", () => {
    const noisy = `Sure! Here's the analysis you asked for:\n\n\`\`\`json\n${json}\n\`\`\`\n\nLet me know if you'd like changes.`;
    expect(JSON.parse(extractJsonBlock(noisy))).toEqual(valid);
  });

  it("finds unfenced JSON that follows a preamble", () => {
    expect(JSON.parse(extractJsonBlock(`Here is the output:\n${json}`))).toEqual(valid);
  });

  it("does not stop at a brace inside a string value", () => {
    // A naive lastIndexOf("}") would truncate here.
    const tricky = '{"headline": "uses {curly} braces", "n": 1}';
    expect(JSON.parse(extractJsonBlock(tricky))).toEqual({
      headline: "uses {curly} braces",
      n: 1,
    });
  });

  it("does not stop at an escaped quote inside a string value", () => {
    const tricky = '{"headline": "they said \\"ship it\\" }", "n": 1}';
    expect(JSON.parse(extractJsonBlock(tricky))).toEqual({
      headline: 'they said "ship it" }',
      n: 1,
    });
  });

  it("throws when there is no JSON object at all", () => {
    expect(() => extractJsonBlock("I'm sorry, I can't help with that.")).toThrow(/no json/i);
  });

  it("throws on an empty response", () => {
    expect(() => extractJsonBlock("")).toThrow(/no json/i);
  });
});

describe("parseTriageResponse", () => {
  it("parses and validates a well-formed response", () => {
    expect(parseTriageResponse(json)).toEqual(valid);
  });

  it("parses a fenced response", () => {
    expect(parseTriageResponse("```json\n" + json + "\n```")).toEqual(valid);
  });

  it("tolerates trailing commas, which models emit routinely", () => {
    const trailing = `{
      "headline": "x",
      "signal_level": "low",
      "feature_analysis": "x",
      "strategic_read": "x",
      "hn_reaction_summary": null,
      "category_implication": "x",
      "counter_prd": {
        "problem_statement": "x",
        "why_now": "x",
        "proposed_feature": "x",
        "success_metric": "x",
      },
    }`;
    expect(parseTriageResponse(trailing).signal_level).toBe("low");
  });

  it("keeps a null hn_reaction_summary null rather than inventing a string", () => {
    expect(parseTriageResponse(json).hn_reaction_summary).toBeNull();
  });

  it("accepts a populated hn_reaction_summary", () => {
    const withReaction = JSON.stringify({ ...valid, hn_reaction_summary: "Mostly sceptical." });
    expect(parseTriageResponse(withReaction).hn_reaction_summary).toBe("Mostly sceptical.");
  });

  it("accepts a null category_implication", () => {
    const legacy = JSON.stringify({ ...valid, category_implication: null });
    expect(parseTriageResponse(legacy).category_implication).toBeNull();
  });

  it("accepts an analysis stored before category_implication existed", () => {
    // A missing key is `undefined`, not `null` — a merely nullable schema
    // rejects it, and every pre-existing row would fail validation on read.
    const { category_implication, ...legacy } = valid;
    void category_implication;
    expect(parseTriageResponse(JSON.stringify(legacy)).category_implication).toBeNull();
  });

  it("carries the category implication through", () => {
    expect(parseTriageResponse(json).category_implication).toContain("table stakes");
  });

  it("accepts a null counter_prd, which is the teardown case", () => {
    // No viewer context means nobody to write advice for, so the model is told
    // to return null rather than address a company that doesn't exist.
    const teardown = JSON.stringify({ ...valid, counter_prd: null });
    expect(parseTriageResponse(teardown).counter_prd).toBeNull();
  });

  it("still validates a counter_prd when one is present", () => {
    const bad = JSON.stringify({
      ...valid,
      counter_prd: { ...valid.counter_prd, success_metric: "" },
    });
    expect(() => parseTriageResponse(bad)).toThrow(/success_metric/);
  });

  describe("rejecting output that would corrupt an event row", () => {
    it("rejects a missing top-level field", () => {
      const { strategic_read, ...missing } = valid;
      void strategic_read;
      expect(() => parseTriageResponse(JSON.stringify(missing))).toThrow(/strategic_read/);
    });

    it("rejects a missing counter-PRD field", () => {
      const missing = { ...valid, counter_prd: { ...valid.counter_prd, success_metric: undefined } };
      expect(() => parseTriageResponse(JSON.stringify(missing))).toThrow(/success_metric/);
    });

    it("rejects a signal_level outside the allowed set", () => {
      // "critical" is the kind of thing a model invents when it feels strongly.
      const bad = JSON.stringify({ ...valid, signal_level: "critical" });
      expect(() => parseTriageResponse(bad)).toThrow(/signal_level/);
    });

    it("rejects an empty string where prose is required", () => {
      const bad = JSON.stringify({ ...valid, headline: "" });
      expect(() => parseTriageResponse(bad)).toThrow(/headline/);
    });

    it("rejects a counter_prd that came back as a string", () => {
      const bad = JSON.stringify({ ...valid, counter_prd: "see above" });
      expect(() => parseTriageResponse(bad)).toThrow(/counter_prd/);
    });

    it("rejects a refusal with no JSON in it", () => {
      expect(() => parseTriageResponse("I cannot analyse that.")).toThrow(/no json/i);
    });

    it("includes the offending field name in the error, for debuggable logs", () => {
      const bad = JSON.stringify({ ...valid, signal_level: "critical" });
      expect(() => parseTriageResponse(bad)).toThrow(/signal_level/);
    });
  });
});
