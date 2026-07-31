import type { SignalLevel } from "@/lib/llm/schema";

/**
 * Presentation helpers shared by the timeline and the card detail, so the two
 * can't describe the same signal level differently.
 */

export const SIGNAL_META: Record<
  SignalLevel,
  { label: string; badge: "high" | "medium" | "low"; rail: string; description: string }
> = {
  high: {
    label: "High signal",
    badge: "high",
    rail: "rail-high",
    description: "New capability, product surface, or business-model change",
  },
  medium: {
    label: "Medium signal",
    badge: "medium",
    rail: "rail-medium",
    description: "Meaningful improvement to an existing capability",
  },
  low: {
    // No gradient rail on purpose — low signal should recede, and the absence
    // of colour is what makes the other two read as notable.
    label: "Low signal",
    badge: "low",
    rail: "bg-border",
    description: "Bug fixes, performance work, or notes too generic to read",
  },
};

/** Deterministic on server and client — toLocaleString would drift between them. */
export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = date.getUTCDate();
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");

  return `${day} ${month} ${year}, ${hh}:${mm} UTC`;
}

export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "never";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "never";

  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

/**
 * Render a version with exactly one leading "v".
 *
 * Some publishers ship a version string that already starts with one — eToro's
 * is literally "v651.1310.0" — which rendered as "vv651.1310.0".
 */
export function formatVersion(version: string): string {
  const trimmed = version.trim();
  return trimmed.replace(/^v/i, "");
}
