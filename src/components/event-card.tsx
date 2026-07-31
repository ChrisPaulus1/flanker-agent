"use client";

import * as React from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SIGNAL_META, formatDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FlankerEventWithApp } from "@/lib/storage/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h4>
      <div className="text-[15px] leading-relaxed text-foreground/90">{children}</div>
    </div>
  );
}

function Prose({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((paragraph, i) => (
        <p key={i} className={i > 0 ? "mt-3" : undefined}>
          {paragraph}
        </p>
      ))}
    </>
  );
}

export function EventCard({ event }: { event: FlankerEventWithApp }) {
  const [open, setOpen] = React.useState(false);
  const meta = SIGNAL_META[event.signalLevel];
  const triage = event.llmOutput;
  const isLow = event.signalLevel === "low";

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card
        className={cn(
          "overflow-hidden border-l-4 transition-colors",
          meta.accent,
          // Low-signal releases are the common case. Muting them keeps the
          // timeline scannable — the eye should land on what actually shipped.
          isLow && "bg-muted/30",
        )}
      >
        <CollapsibleTrigger className="group flex w-full items-start gap-4 p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className={cn("font-semibold tracking-tight", isLow && "text-muted-foreground")}>
                {event.app.name}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                v{event.version}
              </span>
              <Badge variant={meta.badge}>{meta.label}</Badge>
            </div>

            <p
              className={cn(
                "mt-2 text-[15px] leading-snug",
                isLow ? "text-muted-foreground" : "font-medium text-foreground",
              )}
            >
              {triage.headline}
            </p>

            {/*
              Metadata stacks one-per-line on narrow screens and sits inline on
              wider ones. Separators are ::before pseudo-elements gated to sm+
              so they never dangle: as standalone spans they stranded a middot
              at the end of a wrapped line, and unconditionally they stranded
              one at the start of it.
            */}
            <div className="mt-2 flex flex-col gap-y-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:[&>*:not(:first-child)]:before:mr-3 sm:[&>*:not(:first-child)]:before:content-['·']">
              <span title={formatDate(event.detectedAt)}>
                detected {relativeTime(event.detectedAt)}
              </span>
              <span>released {formatDate(event.releaseDate)}</span>
              {event.hnStoryRefs.length > 0 && (
                <span>
                  {event.hnStoryRefs.length} HN thread
                  {event.hnStoryRefs.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>

          <ChevronDown
            className={cn(
              "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="space-y-6 border-t px-5 pb-6 pt-5">
            <Section title="What shipped — release notes, verbatim">
              <blockquote className="whitespace-pre-wrap rounded-md border-l-2 bg-muted/50 px-3.5 py-3 font-mono text-[13px] leading-relaxed text-muted-foreground">
                {event.releaseNotes?.trim() || "The developer published no release notes for this version."}
              </blockquote>
            </Section>

            <Section title="What it actually does">
              <Prose text={triage.feature_analysis} />
            </Section>

            <Section title="Strategic read">
              <Prose text={triage.strategic_read} />
            </Section>

            <Section title="Community reaction">
              {triage.hn_reaction_summary ? (
                <>
                  <Prose text={triage.hn_reaction_summary} />
                  {event.hnStoryRefs.length > 0 && (
                    <ul className="mt-3 space-y-1.5">
                      {event.hnStoryRefs.map((story) => (
                        <li key={story.objectId}>
                          <a
                            href={story.hnUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-baseline gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          >
                            <span className="font-mono text-xs tabular-nums">
                              {story.points}▲ {story.numComments}💬
                            </span>
                            <span>{story.title}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="italic text-muted-foreground">
                  No relevant Hacker News discussion found for this release.
                </p>
              )}
            </Section>

            <div className="rounded-lg border bg-muted/40 p-4">
              <h4 className="mb-3 text-sm font-semibold tracking-tight">Counter-PRD</h4>
              <dl className="space-y-3">
                {[
                  ["Problem statement", triage.counter_prd.problem_statement],
                  ["Why now", triage.counter_prd.why_now],
                  ["Proposed response", triage.counter_prd.proposed_feature],
                  ["Success metric", triage.counter_prd.success_metric],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-[15px] leading-relaxed text-foreground/90">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-xs text-muted-foreground">
              <span>
                Analysed by{" "}
                <span className="font-mono">{event.model ?? "an unrecorded model"}</span> · inferred
                from public release notes and may be wrong
              </span>
              <a
                href={`https://apps.apple.com/us/app/id${event.app.itunesTrackId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline"
              >
                App Store <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
