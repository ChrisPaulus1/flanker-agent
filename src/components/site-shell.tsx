import Link from "next/link";
import { Activity } from "lucide-react";
import { ProductPicker } from "@/components/product-picker";
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
          <div className="flex items-center gap-2">
            <ProductPicker />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/*
        `main` is flex-1 *below* the header, so justify-center centres within
        the leftover space rather than the viewport — which lands the content
        half a header-height too low (measured: 30px at every viewport size).
        The extra bottom padding of one header height pulls it back up by half
        of that, putting the block on the true centre of the screen.
      */}
      <main
        className={cn(
          "container flex-1",
          center
            ? "flex flex-col items-center justify-center py-16 pb-[calc(4rem+var(--header-h))]"
            : "py-8 md:py-12",
        )}
      >
        {children}
      </main>

    </div>
  );
}
