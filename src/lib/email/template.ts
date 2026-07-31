import type { AppRelease } from "@/lib/sources/itunes";
import type { FlankerEvent } from "@/lib/storage/types";
import type { SignalLevel } from "@/lib/llm/schema";

/**
 * The alert email.
 *
 * Built as a plain HTML string with inline styles and table layout, because
 * that is what mail clients actually render — Gmail strips <style> blocks,
 * Outlook ignores flexbox, and no client can be relied on for CSS variables or
 * prefers-color-scheme. The palette mirrors the dashboard's signal colours so
 * the two read as one product.
 */

/*
  Mirrors the dashboard's --signal-* tokens. Hardcoded hex because mail clients
  don't support CSS variables — these are the computed light-mode values of the
  same scale, so the email and the dashboard read as one product.
*/
const SIGNAL_STYLE: Record<SignalLevel, { color: string; bg: string; label: string }> = {
  high: { color: "#8a5a09", bg: "#fbf1dc", label: "HIGH SIGNAL" },
  medium: { color: "#5b2bbf", bg: "#f0e9fc", label: "MEDIUM SIGNAL" },
  low: { color: "#5a6a80", bg: "#eef1f6", label: "LOW SIGNAL" },
};

/**
 * Release notes come from a third party and land inside our HTML, so they are
 * escaped rather than trusted.
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function paragraphs(text: string): string {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function section(title: string, body: string): string {
  return `
    <tr>
      <td style="padding:20px 28px 0;">
        <div style="font:600 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">${escapeHtml(title)}</div>
        <div style="font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">${body}</div>
      </td>
    </tr>`;
}

function prdRow(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:0 0 14px;">
        <div style="font:600 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#475569;margin-bottom:3px;">${escapeHtml(label)}</div>
        <div style="font:400 15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">${escapeHtml(value)}</div>
      </td>
    </tr>`;
}

export function buildAlertSubject(appName: string, event: FlankerEvent): string {
  const prefix = event.signalLevel === "high" ? "🔴" : event.signalLevel === "medium" ? "🔵" : "⚪️";
  return `${prefix} ${appName} v${event.version} — ${event.llmOutput.headline}`;
}

export function buildAlertHtml({
  appName,
  release,
  event,
  dashboardUrl,
}: {
  appName: string;
  release: AppRelease;
  event: FlankerEvent;
  dashboardUrl: string;
}): string {
  const triage = event.llmOutput;
  const signal = SIGNAL_STYLE[event.signalLevel];
  const notes = release.releaseNotes?.trim();

  const hnBlock = triage.hn_reaction_summary
    ? paragraphs(triage.hn_reaction_summary)
    : `<p style="margin:0;color:#64748b;font-style:italic;">No relevant Hacker News discussion found for this release.</p>`;

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f0eef8;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0eef8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e1e7f0;overflow:hidden;">

        <tr>
          <td style="padding:24px 28px 0;">
            <div style="font:700 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.14em;color:#94a3b8;text-transform:uppercase;">Flanker</div>
            <div style="margin-top:14px;">
              <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${signal.bg};color:${signal.color};font:700 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.06em;">${signal.label}</span>
            </div>
            <h1 style="margin:12px 0 4px;font:700 22px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">${escapeHtml(appName)} shipped v${escapeHtml(event.version)}</h1>
            <div style="font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#64748b;">${escapeHtml(triage.headline)}</div>
            <div style="font:400 13px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#94a3b8;margin-top:6px;">Released ${escapeHtml(release.releaseDate)} · detected ${escapeHtml(event.detectedAt)}</div>
          </td>
        </tr>

        <tr>
          <td style="padding:20px 28px 0;">
            <div style="font:600 11px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">What shipped — release notes, verbatim</div>
            <div style="background:#f8f7fc;border-left:3px solid #7c3aed;border-radius:0 6px 6px 0;padding:12px 14px;font:400 14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#334155;white-space:pre-wrap;">${notes ? escapeHtml(notes) : "<em style='color:#94a3b8'>The developer published no release notes for this version.</em>"}</div>
          </td>
        </tr>

        ${section("What it actually does", paragraphs(triage.feature_analysis))}
        ${section("Strategic read", paragraphs(triage.strategic_read))}
        ${section("Community reaction", hnBlock)}

        <tr>
          <td style="padding:24px 28px 0;">
            <div style="border-top:1px solid #e1e7f0;padding-top:20px;">
              <div style="font:700 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;margin-bottom:14px;">Counter-PRD</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${prdRow("Problem statement", triage.counter_prd.problem_statement)}
                ${prdRow("Why now", triage.counter_prd.why_now)}
                ${prdRow("Proposed response", triage.counter_prd.proposed_feature)}
                ${prdRow("Success metric", triage.counter_prd.success_metric)}
              </table>
            </div>
          </td>
        </tr>

        <tr>
          <td style="padding:8px 28px 28px;">
            <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#0b1a33;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">Open dashboard</a>
            <a href="${escapeHtml(release.trackViewUrl)}" style="display:inline-block;margin-left:8px;color:#475569;text-decoration:none;padding:11px 12px;font:500 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">View on App Store</a>
          </td>
        </tr>

        <tr>
          <td style="padding:14px 28px;background:#f7f9fc;border-top:1px solid #e1e7f0;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#94a3b8;">
            Analysis generated by ${escapeHtml(event.model ?? "an unrecorded model")}. Feature and strategy sections are inferred from public release notes and may be wrong.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Plain-text alternative, for clients that refuse HTML. */
export function buildAlertText({
  appName,
  release,
  event,
  dashboardUrl,
}: {
  appName: string;
  release: AppRelease;
  event: FlankerEvent;
  dashboardUrl: string;
}): string {
  const t = event.llmOutput;
  return [
    `FLANKER — ${event.signalLevel.toUpperCase()} SIGNAL`,
    `${appName} shipped v${event.version}`,
    t.headline,
    `Released ${release.releaseDate} · detected ${event.detectedAt}`,
    "",
    "WHAT SHIPPED (verbatim)",
    release.releaseNotes?.trim() || "(no release notes published)",
    "",
    "WHAT IT ACTUALLY DOES",
    t.feature_analysis,
    "",
    "STRATEGIC READ",
    t.strategic_read,
    "",
    "COMMUNITY REACTION",
    t.hn_reaction_summary ?? "No relevant Hacker News discussion found for this release.",
    "",
    "COUNTER-PRD",
    `Problem statement: ${t.counter_prd.problem_statement}`,
    `Why now: ${t.counter_prd.why_now}`,
    `Proposed response: ${t.counter_prd.proposed_feature}`,
    `Success metric: ${t.counter_prd.success_metric}`,
    "",
    `Dashboard: ${dashboardUrl}`,
    `App Store: ${release.trackViewUrl}`,
    "",
    `Analysis generated by ${event.model ?? "an unrecorded model"}. Inferred from public release notes and may be wrong.`,
  ].join("\n");
}
