"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatVersion } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrackedApp } from "@/lib/storage/types";

const VISIBLE = 3;

function AppChip({ app }: { app: TrackedApp }) {
  return (
    <a
      href={`https://apps.apple.com/us/app/id${app.itunesTrackId}`}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-2 rounded-full border border-gold-hairline/60 bg-gradient-to-r from-grad-veil to-grad-violet/35 px-3 py-1.5 text-sm transition-colors hover:border-gold/70 hover:to-grad-violet/60"
    >
      <span className="font-medium text-foreground/90">{app.name}</span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {app.lastSeenVersion ? `v${formatVersion(app.lastSeenVersion)}` : "not yet seen"}
      </span>
    </a>
  );
}

/**
 * Which competitors Flanker is watching.
 *
 * The stat tile it replaced said "7" and nothing else, which tells a visitor
 * the agent is running but not what it's running against — the competitor set
 * is the more interesting fact. Three are shown by default and the rest are one
 * click away, so the panel doesn't push the timeline below the fold.
 */
export function TrackedApps({ apps }: { apps: TrackedApp[] }) {
  const [open, setOpen] = React.useState(false);

  const shown = apps.slice(0, VISIBLE);
  const hidden = apps.slice(VISIBLE);

  return (
    <Card className="box-gold surface-card-warm overflow-hidden p-4 sm:p-5">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Apps tracked
            <span className="ml-2 font-mono text-xs tabular-nums text-primary">{apps.length}</span>
          </div>

          {hidden.length > 0 && (
            <CollapsibleTrigger className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {open ? "See less" : `See ${hidden.length} more`}
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")}
                aria-hidden
              />
            </CollapsibleTrigger>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {shown.map((app) => (
            <AppChip key={app.id} app={app} />
          ))}
        </div>

        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="mt-2 flex flex-wrap gap-2">
            {hidden.map((app) => (
              <AppChip key={app.id} app={app} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
