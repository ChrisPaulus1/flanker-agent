import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "@/lib/auth";

const SECRET = "3f7a9c1e5b2d8f4a6c0e9b7d3a5f1c8e";

describe("isAuthorizedCronRequest", () => {
  it("accepts the configured secret as a bearer token", () => {
    expect(isAuthorizedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("accepts a lowercase scheme, since not every caller capitalises it", () => {
    expect(isAuthorizedCronRequest(`bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a missing header", () => {
    expect(isAuthorizedCronRequest(null, SECRET)).toBe(false);
  });

  it("rejects a wrong secret of the same length", () => {
    const wrong = "0".repeat(SECRET.length);
    expect(isAuthorizedCronRequest(`Bearer ${wrong}`, SECRET)).toBe(false);
  });

  it("rejects a secret of a different length without throwing", () => {
    // timingSafeEqual throws on mismatched buffer lengths, so this path has to
    // be handled explicitly rather than left to the comparison.
    expect(() => isAuthorizedCronRequest("Bearer short", SECRET)).not.toThrow();
    expect(isAuthorizedCronRequest("Bearer short", SECRET)).toBe(false);
  });

  it("rejects the raw secret without the Bearer scheme", () => {
    expect(isAuthorizedCronRequest(SECRET, SECRET)).toBe(false);
  });

  it("rejects a different auth scheme carrying the right value", () => {
    expect(isAuthorizedCronRequest(`Basic ${SECRET}`, SECRET)).toBe(false);
  });

  it("never authorises when the configured secret is empty", () => {
    // A missing CRON_SECRET in production must fail closed, not make the
    // endpoint public to anyone sending "Bearer ".
    expect(isAuthorizedCronRequest("Bearer ", "")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer anything", "")).toBe(false);
    expect(isAuthorizedCronRequest(null, "")).toBe(false);
  });

  it("rejects an empty bearer value", () => {
    expect(isAuthorizedCronRequest("Bearer ", SECRET)).toBe(false);
  });
});
