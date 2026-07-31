import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

// Thin, but it proves the vitest + "@/" path alias wiring actually resolves
// against src/ before any real logic depends on it.
describe("cn", () => {
  it("merges conditional classes", () => {
    expect(cn("px-2", false && "hidden", "py-1")).toBe("px-2 py-1");
  });

  it("lets later tailwind utilities win over earlier conflicting ones", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
