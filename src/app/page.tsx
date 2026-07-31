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

        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          {/* Singular when the count is unavailable, or this reads "any App Store apps". */}
          Search {total && total > 0 ? `${total.toLocaleString()} App Store apps` : "any App Store app"}{" "}
          to see what a company actually shipped — release notes reverse-engineered into a strategic
          read, with the filler separated from the releases that matter.
        </p>

        <div className="mx-auto mt-8 max-w-xl">
          <SearchBox autoFocus />
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Try <span className="font-medium text-foreground">Snapchat</span>,{" "}
          <span className="font-medium text-foreground">Spotify</span> or{" "}
          <span className="font-medium text-foreground">Robinhood</span>
        </p>
      </div>
    </SiteShell>
  );
}
