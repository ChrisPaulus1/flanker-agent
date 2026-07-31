import { describe, expect, it } from "vitest";
import { isSearchable, search, suggest, TYPEAHEAD_LIMIT } from "@/lib/catalog/search";
import { FakeRepo } from "./fakes";
import type { CatalogApp } from "@/lib/storage/types";

function app(name: string, rank: number | null = null, id = name.length * 1000 + rank!): CatalogApp {
  return {
    itunesTrackId: Number.isFinite(id) ? id : name.charCodeAt(0) * 7919,
    name,
    developer: `${name} Inc.`,
    genre: "Utilities",
    iconUrl: null,
    version: "1.0.0",
    releaseNotes: null,
    releaseDate: null,
    popularityRank: rank,
  };
}

async function repoWith(apps: CatalogApp[]) {
  const repo = new FakeRepo([]);
  await repo.upsertCatalogApps(apps);
  return repo;
}

describe("isSearchable", () => {
  it("needs at least one non-space character", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("   ")).toBe(false);
    expect(isSearchable("s")).toBe(true);
  });
});

describe("suggest", () => {
  it("returns at most three suggestions", async () => {
    const repo = await repoWith([
      app("Spotify", 1),
      app("Snapchat", 2),
      app("Shazam", 3),
      app("Slack", 4),
      app("Strava", 5),
    ]);
    const out = await suggest(repo, "s");
    expect(out).toHaveLength(TYPEAHEAD_LIMIT);
    expect(TYPEAHEAD_LIMIT).toBe(3);
  });

  it("ranks by popularity, so 's' surfaces the apps people mean", async () => {
    // Without ranking, an alphabetical match would put a dead app above
    // Spotify purely because its name sorts earlier.
    const repo = await repoWith([
      app("Sandwich Tracker", null),
      app("Spotify", 1),
      app("Snapchat", 2),
    ]);
    const out = await suggest(repo, "s");
    expect(out.map((s) => s.name)).toEqual(["Spotify", "Snapchat", "Sandwich Tracker"]);
  });

  it("narrows as the query grows", async () => {
    const repo = await repoWith([app("Spotify", 1), app("Snapchat", 2), app("Shazam", 3)]);
    expect((await suggest(repo, "sn")).map((s) => s.name)).toEqual(["Snapchat"]);
    expect((await suggest(repo, "snapchat")).map((s) => s.name)).toEqual(["Snapchat"]);
  });

  it("is case-insensitive", async () => {
    const repo = await repoWith([app("Spotify", 1)]);
    expect(await suggest(repo, "SPOT")).toHaveLength(1);
    expect(await suggest(repo, "sPoTiFy")).toHaveLength(1);
  });

  it("falls back to substring matching when prefix hits run out", async () => {
    // "cash" should still reach Cash App even when the brand isn't first.
    const repo = await repoWith([app("Block: Cash App", 5)]);
    const out = await suggest(repo, "cash");
    expect(out.map((s) => s.name)).toEqual(["Block: Cash App"]);
  });

  it("puts prefix matches ahead of substring matches", async () => {
    const repo = await repoWith([app("Zoom Cash", 1), app("Cash App", 9)]);
    const out = await suggest(repo, "cash");
    expect(out[0].name).toBe("Cash App");
  });

  it("never returns the same app twice when both queries match it", async () => {
    const repo = await repoWith([app("Slack", 1), app("Strava", 2)]);
    const out = await suggest(repo, "s");
    expect(new Set(out.map((s) => s.itunesTrackId)).size).toBe(out.length);
  });

  it("returns nothing for an empty query rather than the whole catalog", async () => {
    const repo = await repoWith([app("Spotify", 1), app("Snapchat", 2)]);
    expect(await suggest(repo, "")).toEqual([]);
    expect(await suggest(repo, "   ")).toEqual([]);
  });

  it("returns nothing when there is genuinely no match", async () => {
    const repo = await repoWith([app("Spotify", 1)]);
    expect(await suggest(repo, "zzzzz")).toEqual([]);
  });

  it("carries the fields the dropdown renders", async () => {
    const repo = await repoWith([app("Spotify", 1)]);
    const [s] = await suggest(repo, "spot");
    expect(s).toMatchObject({
      name: "Spotify",
      developer: "Spotify Inc.",
      version: "1.0.0",
    });
    expect(s).toHaveProperty("iconUrl");
    expect(s).toHaveProperty("itunesTrackId");
  });
});

describe("search", () => {
  it("returns more than the type-ahead cap", async () => {
    const many = Array.from({ length: 30 }, (_, i) => app(`Sample ${i}`, i + 1, 90000 + i));
    const repo = await repoWith(many);
    const out = await search(repo, "sample");
    expect(out.length).toBeGreaterThan(TYPEAHEAD_LIMIT);
  });

  it("matches on substring, not just prefix", async () => {
    const repo = await repoWith([app("Google Maps", 1)]);
    expect((await search(repo, "maps")).map((s) => s.name)).toEqual(["Google Maps"]);
  });

  it("returns nothing for an empty query", async () => {
    const repo = await repoWith([app("Spotify", 1)]);
    expect(await search(repo, "  ")).toEqual([]);
  });
});
