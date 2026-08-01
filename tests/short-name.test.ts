import { describe, expect, it } from "vitest";
import { shortAppName } from "@/lib/format";

describe("shortAppName", () => {
  it("drops the marketing tail that overflows inline labels", () => {
    expect(shortAppName("Bumble Dating App: Meet & Date")).toBe("Bumble Dating App");
    expect(shortAppName("Tinder Dating App: Date & Chat")).toBe("Tinder Dating App");
  });

  it("handles en and em dashes, not just colons", () => {
    expect(shortAppName("Chime® – Mobile Banking")).toBe("Chime");
    expect(shortAppName("Uber — Request a ride")).toBe("Uber");
  });

  it("strips trademark marks", () => {
    expect(shortAppName("Zelle®")).toBe("Zelle");
  });

  it("leaves a name with no tail alone", () => {
    expect(shortAppName("Spotify")).toBe("Spotify");
    expect(shortAppName("ChatGPT")).toBe("ChatGPT");
  });

  it("falls back to the full name rather than returning nothing", () => {
    // A title that is only a separator would otherwise render as an empty label.
    expect(shortAppName(": Something")).toBe(": Something");
  });
});
