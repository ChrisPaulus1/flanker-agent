import { describe, expect, it } from "vitest";
import { buildTriagePrompt } from "@/lib/llm/prompt";
import { makeApp, makeRelease } from "./fakes";

const base = { app: makeApp({ name: "Varo Bank" }), release: makeRelease(), reaction: null };

/**
 * The prompt used to hardcode its reader as "a product team that builds a
 * consumer FinTech app", and the output said "our app" for a company that was
 * never defined. Across a 10,000-app catalog that produces strategy for a
 * fictional company on every page. These tests pin the two modes down.
 */
describe("buildTriagePrompt — teardown mode (no viewer context)", () => {
  const prompt = buildTriagePrompt({ ...base, viewer: null });

  it("never speaks as an unnamed 'we'", () => {
    expect(prompt).not.toMatch(/\bour (app|product|team|users)\b/i);
    expect(prompt).not.toMatch(/how should we respond/i);
  });

  it("does not assume the reader owns a competing product", () => {
    expect(prompt).not.toMatch(/consumer FinTech app/i);
    expect(prompt).not.toMatch(/competitor'?s App Store release/i);
  });

  it("instructs a null counter_prd", () => {
    expect(prompt).toMatch(/"counter_prd"\s*:\s*null/);
  });

  it("still asks for the analysis that doesn't need a reader", () => {
    expect(prompt).toMatch(/feature_analysis/);
    expect(prompt).toMatch(/strategic_read/);
    expect(prompt).toMatch(/signal_level/);
  });

  it("names the app being analysed", () => {
    expect(prompt).toContain("Varo Bank");
  });
});

describe("buildTriagePrompt — counter-PRD mode (viewer context set)", () => {
  const viewer = { name: "Monzo", genre: "Finance", developer: "Monzo Bank Limited" };
  const prompt = buildTriagePrompt({ ...base, viewer });

  it("names the viewer's product as the reader", () => {
    expect(prompt).toContain("Monzo");
  });

  it("asks for a populated counter_prd", () => {
    expect(prompt).not.toMatch(/"counter_prd"\s*:\s*null/);
    expect(prompt).toMatch(/problem_statement/);
    expect(prompt).toMatch(/success_metric/);
  });

  it("keeps the two products distinct so advice isn't written backwards", () => {
    // The analysed app and the viewer's app must be labelled separately, or
    // the model writes the counter-PRD for the competitor.
    expect(prompt).toContain("Varo Bank");
    expect(prompt).toContain("Monzo");
    expect(prompt).toMatch(/YOUR PRODUCT|THE READER'S PRODUCT/i);
  });

  it("rejects non-actionable proposals", () => {
    expect(prompt).toMatch(/monitor the situation|conduct user research/i);
  });

  it("handles a viewer whose product is the same app being analysed", () => {
    // A visitor may well look up their own app. The prompt should say so
    // rather than generating advice to compete with yourself.
    const selfPrompt = buildTriagePrompt({
      ...base,
      viewer: { name: "Varo Bank", genre: "Finance", developer: "Varo Money, Inc." },
    });
    expect(selfPrompt).toMatch(/same product|your own release/i);
  });
});

describe("buildTriagePrompt — shared behaviour", () => {
  it("includes the verbatim release notes in both modes", () => {
    for (const viewer of [null, { name: "Monzo" }]) {
      const prompt = buildTriagePrompt({ ...base, viewer });
      expect(prompt).toContain("Added instant paycheck advances up to $500.");
    }
  });


  it("handles an app that published no release notes", () => {
    const prompt = buildTriagePrompt({
      ...base,
      release: makeRelease({ releaseNotes: null }),
      viewer: null,
    });
    expect(prompt).toMatch(/no release notes/i);
  });
});
