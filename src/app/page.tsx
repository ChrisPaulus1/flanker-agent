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
          One emphasis only: the scale, which is the credibility claim.
          Bolding several phrases out of thirty words emphasised nothing.
        */}
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl md:leading-relaxed">
          {/* Singular when the count is unavailable, or this reads "any iOS apps". */}
          Search{" "}
          <span className="font-semibold text-foreground">
            {total && total > 0 ? `${total.toLocaleString()} iOS apps` : "any iOS app"}
          </span>{" "}
          to see exactly what companies are shipping. Flanker reverse-engineers product updates into
          strategic insights and actionable counter-PRDs.
        </p>

        <div className="mx-auto mt-9 max-w-xl">
          <SearchBox autoFocus />
        </div>

      </div>
    </SiteShell>
  );
}
