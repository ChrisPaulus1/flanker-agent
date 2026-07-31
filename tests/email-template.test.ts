import { describe, expect, it } from "vitest";
import { buildAlertHtml, buildAlertSubject, buildAlertText, escapeHtml } from "@/lib/email/template";
import { makeRelease, makeTriage } from "./fakes";
import type { FlankerEvent } from "@/lib/storage/types";
import type { LlmTriage } from "@/lib/llm/schema";

function makeEvent(triage: Partial<LlmTriage> = {}, overrides: Partial<FlankerEvent> = {}): FlankerEvent {
  return {
    id: "event-1",
    appId: "app-1",
    version: "5.337.0",
    releaseNotes: "Added instant paycheck advances up to $500.",
    releaseDate: "2026-07-28T20:10:14Z",
    hnSummary: null,
    hnStoryRefs: [],
    llmOutput: makeTriage(triage),
    signalLevel: triage.signal_level ?? "high",
    model: "gemini-3.5-flash-lite",
    detectedAt: "2026-07-30T12:00:00.000Z",
    emailSentAt: null,
    ...overrides,
  };
}

const base = { appName: "Chime", release: makeRelease(), dashboardUrl: "https://flanker.test" };

describe("escapeHtml", () => {
  it("escapes the characters that would break out of an attribute or element", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapes ampersands before anything else, so entities aren't double-broken", () => {
    expect(escapeHtml("Tom & Jerry <b>")).toBe("Tom &amp; Jerry &lt;b&gt;");
  });
});

describe("buildAlertHtml", () => {
  it("includes everything the alert is supposed to carry", () => {
    const html = buildAlertHtml({ ...base, event: makeEvent() });

    expect(html).toContain("Chime");
    expect(html).toContain("5.337.0");
    expect(html).toContain("2026-07-28T20:10:14Z"); // released
    expect(html).toContain("2026-07-30T12:00:00.000Z"); // detected
    expect(html).toContain("Added instant paycheck advances up to $500."); // raw notes
    expect(html).toContain("Short-term liquidity product"); // feature analysis
    expect(html).toContain("Deepens primary-account behaviour"); // strategic read
    expect(html).toContain("Users bridge shortfalls"); // counter-PRD problem
    expect(html).toContain("Earned-wage access"); // counter-PRD proposal
    expect(html).toContain("30-day repeat usage"); // counter-PRD metric
  });

  it("escapes release notes rather than trusting third-party text", () => {
    // Release notes are attacker-influenced text landing inside our HTML.
    const event = makeEvent({}, { releaseNotes: '<img src=x onerror="alert(1)">' });
    const html = buildAlertHtml({
      ...base,
      release: makeRelease({ releaseNotes: '<img src=x onerror="alert(1)">' }),
      event,
    });

    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("says plainly when there was no community discussion", () => {
    const html = buildAlertHtml({ ...base, event: makeEvent({ hn_reaction_summary: null }) });
    expect(html).toContain("No relevant Hacker News discussion found");
  });

  it("renders the reaction summary when there was one", () => {
    const html = buildAlertHtml({
      ...base,
      event: makeEvent({ hn_reaction_summary: "Commenters were sceptical about fees." }),
    });
    expect(html).toContain("Commenters were sceptical about fees.");
    expect(html).not.toContain("No relevant Hacker News discussion found");
  });

  it("handles an app that published no release notes", () => {
    const html = buildAlertHtml({
      ...base,
      release: makeRelease({ releaseNotes: null }),
      event: makeEvent({}, { releaseNotes: null }),
    });
    expect(html).toContain("published no release notes");
  });

  it("colours the badge by signal level", () => {
    const high = buildAlertHtml({ ...base, event: makeEvent({ signal_level: "high" }) });
    const low = buildAlertHtml({ ...base, event: makeEvent({ signal_level: "low" }) });

    expect(high).toContain("HIGH SIGNAL");
    expect(low).toContain("LOW SIGNAL");
    expect(high).not.toBe(low);
  });

  it("discloses which model produced the analysis", () => {
    const html = buildAlertHtml({ ...base, event: makeEvent() });
    expect(html).toContain("gemini-3.5-flash-lite");
  });

  it("uses inline styles only, since mail clients strip style blocks", () => {
    const html = buildAlertHtml({ ...base, event: makeEvent() });
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<link[\s>]/i);
  });
});

describe("buildAlertSubject", () => {
  it("leads with the app, version and headline", () => {
    const subject = buildAlertSubject("Chime", makeEvent());
    expect(subject).toContain("Chime");
    expect(subject).toContain("5.337.0");
    expect(subject).toContain("instant paycheck advances");
  });

  it("marks high and low signal differently so the inbox is scannable", () => {
    const high = buildAlertSubject("Chime", makeEvent({ signal_level: "high" }));
    const low = buildAlertSubject("Chime", makeEvent({ signal_level: "low" }));
    expect(high).not.toBe(low);
  });
});

describe("buildAlertText", () => {
  it("carries the same content as the HTML version, unescaped", () => {
    const text = buildAlertText({ ...base, event: makeEvent() });
    expect(text).toContain("Added instant paycheck advances up to $500.");
    expect(text).toContain("COUNTER-PRD");
    expect(text).toContain("Success metric: 30-day repeat usage among enrolled users.");
    expect(text).not.toContain("&amp;");
  });

  it("states the empty reaction case in plain text too", () => {
    const text = buildAlertText({ ...base, event: makeEvent({ hn_reaction_summary: null }) });
    expect(text).toContain("No relevant Hacker News discussion found");
  });
});
