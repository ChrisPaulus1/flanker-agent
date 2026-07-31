import Link from "next/link";
import { Activity } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The chrome shared by every page: tri-colour brand bar, sticky header with
 * the wordmark and theme toggle, page wash, footer.
 *
 * Extracted so the landing page and the per-app timeline can't drift into
 * looking like two different products — they use the same tokens, the same
 * wash and the same header by construction rather than by discipline.
 */
export function SiteShell({
  children,
  center = false,
}: {
  children: React.ReactNode;
  /** Landing page centres its content in the viewport; the timeline doesn't. */
  center?: boolean;
}) {
  return (
    <div className="page-wash flex min-h-screen flex-col bg-background">
      <div className="brand-bar" aria-hidden />

      <header className="sticky top-0 z-[9] border-b border-border/60 bg-background/70 backdrop-blur-xl supports-[backdrop-filter]:bg-background/50">
        <div className="container flex h-14 items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Activity className="h-5 w-5 text-tangerine" aria-hidden />
            <span className="font-semibold tracking-tight">Flanker</span>
            <Badge variant="outline" className="hidden font-normal sm:inline-flex">
              App Store intelligence
            </Badge>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main
        className={cn(
          "container flex-1",
          center ? "flex flex-col items-center justify-center py-16" : "py-8 md:py-12",
        )}
      >
        {children}
      </main>

      <footer className="border-t border-border/60">
        <div className="container py-6 text-xs text-muted-foreground">
          Flanker reads the iTunes Search API and Hacker News, then uses Gemini to draft the
          analysis. Feature and strategy sections are inferred from public release notes and may be
          wrong.
        </div>
      </footer>
    </div>
  );
}
