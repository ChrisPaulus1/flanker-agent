import { SearchBox } from "@/components/search-box";
import { SiteShell } from "@/components/site-shell";
import { SupabaseFlankerRepo } from "@/lib/storage/repo";

// The catalog size is read live, so the headline number is never a stale claim.
export const dynamic = "force-dynamic";

async function catalogSize(): Promise<number | null> {
  try {
    return await new SupabaseFlankerRepo().countCatalogApps();
  } catch {
    // A dead database shouldn't stop the search page rendering — the count is
    // decoration, the search box is the product.
    return null;
  }
}

export default async function HomePage() {
  const total = await catalogSize();

  return (
    <SiteShell center>
      {/* Info above the search bar, search-engine style. */}
      <div className="w-full max-w-2xl text-center">
        {/*
          The tri-colour gradient the old "Release timeline" heading used:
          foreground into indigo into tangerine, so it reads navy-to-orange in
          light mode and white-to-purple-to-orange in dark.
        */}
        <h1 className="text-gradient text-4xl font-semibold tracking-tight md:text-5xl">Flanker</h1>

        {/*
          Set larger than typical body copy and with the load-bearing phrases at
          full contrast. This is the one paragraph that has to explain the whole
          product, so it's sized to be read comfortably rather than scanned.
        */}
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl md:leading-relaxed">
          {/* Singular when the count is unavailable, or this reads "any iOS apps". */}
          Search{" "}
          <span className="font-semibold text-foreground">
            {total && total > 0 ? `${total.toLocaleString()} iOS apps` : "any iOS app"}
          </span>{" "}
          to see <span className="font-semibold text-foreground">exactly what companies are shipping</span>.
          Flanker decodes product updates into{" "}
          <span className="font-semibold text-foreground">strategic insights</span> and{" "}
          <span className="font-semibold text-foreground">actionable counter-PRDs</span>.
        </p>

        <div className="mx-auto mt-9 max-w-xl">
          <SearchBox autoFocus />
        </div>

        <p className="mt-5 text-sm text-muted-foreground">
          Try <span className="font-semibold text-foreground">Snapchat</span>,{" "}
          <span className="font-semibold text-foreground">Spotify</span> or{" "}
          <span className="font-semibold text-foreground">Robinhood</span>
        </p>
      </div>
    </SiteShell>
  );
}
