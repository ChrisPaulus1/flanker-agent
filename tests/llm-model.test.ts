import { describe, expect, it } from "vitest";
import { rankModels } from "@/lib/llm/model";

const model = (name: string, supportedActions = ["generateContent"]) => ({
  name: `models/${name}`,
  supportedActions,
});

describe("rankModels", () => {
  it("prefers the newest version family", () => {
    const ranked = rankModels([model("gemini-2.5-flash"), model("gemini-3.6-flash"), model("gemini-3.5-flash")]);
    expect(ranked[0]).toBe("gemini-3.6-flash");
  });

  it("compares minor versions numerically, not lexically", () => {
    // "3.10" must beat "3.5" — a string sort gets this backwards.
    const ranked = rankModels([model("gemini-3.5-flash"), model("gemini-3.10-flash")]);
    expect(ranked[0]).toBe("gemini-3.10-flash");
  });

  it("prefers flash over flash-lite and pro within a version", () => {
    const ranked = rankModels([
      model("gemini-2.5-pro"),
      model("gemini-2.5-flash-lite"),
      model("gemini-2.5-flash"),
    ]);
    expect(ranked).toEqual(["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"]);
  });

  it("prefers a stable model over a preview of the same version", () => {
    // Previews carry tighter free quotas and get withdrawn without notice.
    const ranked = rankModels([
      model("gemini-3.5-flash-preview-11-2025"),
      model("gemini-3.5-flash"),
    ]);
    expect(ranked[0]).toBe("gemini-3.5-flash");
  });

  it("still ranks a newer preview above an older stable release", () => {
    const ranked = rankModels([model("gemini-2.5-flash"), model("gemini-3.6-flash-preview")]);
    expect(ranked[0]).toBe("gemini-3.6-flash-preview");
  });

  it("excludes model families that cannot do text generation", () => {
    const ranked = rankModels([
      model("gemini-3.1-flash-image"),
      model("gemini-embedding-2"),
      model("gemini-2.5-flash-tts"),
      model("gemini-live-2.5-flash"),
      model("gemini-2.5-flash"),
    ]);
    expect(ranked).toEqual(["gemini-2.5-flash"]);
  });

  it("excludes models that advertise actions without generateContent", () => {
    const ranked = rankModels([
      model("gemini-3.5-flash", ["countTokens", "embedContent"]),
      model("gemini-2.5-flash"),
    ]);
    expect(ranked).toEqual(["gemini-2.5-flash"]);
  });

  it("keeps a model that advertises no action list at all", () => {
    // Absence of the field is unknown, not a refusal.
    const ranked = rankModels([{ name: "models/gemini-3.5-flash" }]);
    expect(ranked).toEqual(["gemini-3.5-flash"]);
  });

  it("ignores non-Gemini entries", () => {
    const ranked = rankModels([model("text-bison-001"), model("gemini-2.5-flash")]);
    expect(ranked).toEqual(["gemini-2.5-flash"]);
  });

  it("returns an empty list when nothing is usable, rather than guessing a name", () => {
    expect(rankModels([model("gemini-embedding-2")])).toEqual([]);
  });

  it("is deterministic for equally scored models", () => {
    const input = [model("gemini-3.5-flash-a"), model("gemini-3.5-flash-b")];
    expect(rankModels(input)).toEqual(rankModels([...input].reverse()));
  });
});
