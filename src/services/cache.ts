/**
 * Small localStorage helpers for the book covers on the shelf.
 *
 * Book cover bytes are persisted as data URLs so a later visit renders the
 * shelf straight from storage instead of re-fetching from Open Library.
 * Movie artwork no longer goes through here: it comes from the build-time
 * catalog (see services/catalog.ts).
 */

/** Quota-safe localStorage write; returns false when the write failed. */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded or storage disabled — the URL fallback still works.
    return false;
  }
}

/** Convert an already-loaded, CORS-clean image to a data URL. */
export function imageToDataUrl(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    // Cross-origin taint or canvas failure — skip persistence, keep the URL.
    return null;
  }
}

export type CoverImageCacheEntry = { data: string; w: number; h: number };

export const coverImageCacheKey = (url: string): string => `book_cover_img_${url}`;

export function getCachedCoverImage(url: string): CoverImageCacheEntry | null {
  try {
    const raw = localStorage.getItem(coverImageCacheKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.data === "string" && parsed.data.startsWith("data:")) {
      return parsed;
    }
  } catch {
    // Corrupt entry — treat as a miss.
  }
  return null;
}

/**
 * Persist a cover's bytes as a data URL so a later visit can render the
 * cover straight from localStorage. Returns the stored entry (existing or
 * newly written) or null when persistence isn't possible.
 */
export function persistCoverImage(url: string, img: HTMLImageElement): CoverImageCacheEntry | null {
  const existing = getCachedCoverImage(url);
  if (existing) return existing;
  if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) return null;
  const data = imageToDataUrl(img);
  if (!data) return null;
  const entry: CoverImageCacheEntry = { data, w: img.naturalWidth, h: img.naturalHeight };
  return safeSetItem(coverImageCacheKey(url), JSON.stringify(entry)) ? entry : null;
}
