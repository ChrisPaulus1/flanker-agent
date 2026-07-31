"use client";

import * as React from "react";

/**
 * "Your product" — who the analysis is written for.
 *
 * Stored in localStorage rather than on the server: there is no auth, and a
 * visitor shouldn't have to create an account to find out what a counter-PRD
 * looks like. It also keeps the server stateless, so two people reading the
 * same app can hold different contexts without a session.
 */
export interface ViewerProduct {
  itunesTrackId: number;
  name: string;
  developer: string | null;
  genre: string | null;
  iconUrl: string | null;
}

const STORAGE_KEY = "flanker.viewer";
const CHANGE_EVENT = "flanker:viewer-change";
const OPEN_EVENT = "flanker:open-picker";

/**
 * Ask the header picker to open.
 *
 * Lets a card put the control where the user is looking instead of telling
 * them to go find it — any copy containing the word "above" is usually a
 * missing button.
 */
export function openProductPicker(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function onOpenProductPicker(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}

export function readViewer(): ViewerProduct | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ViewerProduct;
    return typeof parsed?.itunesTrackId === "number" && parsed.name ? parsed : null;
  } catch {
    return null;
  }
}

export function writeViewer(viewer: ViewerProduct | null): void {
  if (typeof window === "undefined") return;
  if (viewer) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(viewer));
  else window.localStorage.removeItem(STORAGE_KEY);

  // `storage` only fires in *other* tabs, so components in this one need their
  // own signal or the header and the cards fall out of sync.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * Subscribe to the current viewer product.
 *
 * Starts null on every render and fills in after mount — reading localStorage
 * during render would produce server/client markup that disagrees.
 */
export function useViewer(): [ViewerProduct | null, (v: ViewerProduct | null) => void, boolean] {
  const [viewer, setViewer] = React.useState<ViewerProduct | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setViewer(readViewer());
    setReady(true);

    const sync = () => setViewer(readViewer());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return [viewer, writeViewer, ready];
}

/**
 * Client-side cache for generated counter-PRDs.
 *
 * Keyed by app, version and viewer, so switching products regenerates and
 * switching back doesn't. Kept out of Postgres deliberately: storing one row
 * per viewer permutation would multiply the events table by the number of
 * distinct readers for no benefit the browser can't provide.
 */
/**
 * Bump when the prompt or output shape changes.
 *
 * Without this, a counter-PRD generated under older logic is served from the
 * browser forever — a fix ships, the page still shows the old answer, and it
 * looks like the fix didn't work. That happened with the relationship
 * classification: pairs already cached kept rendering as competitors.
 */
const PRD_LOGIC_VERSION = "v2";

export function counterPrdCacheKey(trackId: number, version: string, viewerId: number): string {
  return `flanker.prd.${PRD_LOGIC_VERSION}.${trackId}.${version}.${viewerId}`;
}
