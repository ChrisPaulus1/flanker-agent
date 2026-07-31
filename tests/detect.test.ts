import { describe, expect, it } from "vitest";
import { detectRelease } from "@/lib/pipeline/detect";

describe("detectRelease", () => {
  it("treats a never-seen app as a first sighting worth processing", () => {
    expect(detectRelease(null, "5.337.0")).toEqual({
      shouldProcess: true,
      reason: "first-sighting",
    });
  });

  it("does nothing when the version is unchanged", () => {
    expect(detectRelease("5.337.0", "5.337.0")).toEqual({
      shouldProcess: false,
      reason: "unchanged",
    });
  });

  it("processes a changed version", () => {
    expect(detectRelease("5.336.0", "5.337.0")).toEqual({
      shouldProcess: true,
      reason: "version-changed",
    });
  });

  describe("version strings that are not semver", () => {
    // Live values across the tracked set: 5.337.0, 10.141, 2026.30.1, 5.62.0.
    // There is no ordering relation that holds across these, so detection is
    // equality-based only. These cases pin that down.
    it("handles a calendar-versioned app", () => {
      expect(detectRelease("2026.29.4", "2026.30.1").shouldProcess).toBe(true);
    });

    it("handles a two-segment version", () => {
      expect(detectRelease("10.140", "10.141").shouldProcess).toBe(true);
    });

    it("does not try to compare numerically across schemes", () => {
      // 10.141 vs 9.999: a naive numeric compare on the first segment would
      // call this a downgrade. We only care that it differs.
      expect(detectRelease("9.999", "10.141").shouldProcess).toBe(true);
    });

    it("reports a lower version as changed rather than ignoring it", () => {
      // Apple occasionally pulls a build and the store reverts to an earlier
      // version. detectRelease deliberately does NOT special-case this — it has
      // no memory beyond last_seen. Suppressing the duplicate alert is the
      // event store's job, covered in the pipeline tests.
      expect(detectRelease("5.337.0", "5.336.0")).toEqual({
        shouldProcess: true,
        reason: "version-changed",
      });
    });
  });

  describe("normalisation", () => {
    it("ignores surrounding whitespace on either side", () => {
      expect(detectRelease("5.337.0", " 5.337.0 ").shouldProcess).toBe(false);
      expect(detectRelease(" 5.337.0", "5.337.0\n").shouldProcess).toBe(false);
    });

    it("is case-insensitive, for versions carrying a build suffix", () => {
      expect(detectRelease("2026.30.1-RC1", "2026.30.1-rc1").shouldProcess).toBe(false);
    });

    it("treats an empty stored version as never-seen rather than as a change", () => {
      // A blank string in the column would otherwise read as "a version we've
      // seen", and the first real check would look like a version change.
      expect(detectRelease("", "5.337.0").reason).toBe("first-sighting");
      expect(detectRelease("   ", "5.337.0").reason).toBe("first-sighting");
    });

    it("refuses to process an empty current version", () => {
      // Upstream returning nothing must never advance the cursor to "".
      expect(detectRelease("5.337.0", "")).toEqual({
        shouldProcess: false,
        reason: "invalid-current-version",
      });
    });
  });
});
