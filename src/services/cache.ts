/**
 * Random integer between min and max (inclusive).
 */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

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

/** Convert a Blob to a data URL. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

type RevalidateTask = {
  /** Cache key this task keeps fresh. */
  key: string;
  /** Re-runs the source network call and refreshes storage/UI as needed. */
  run: () => Promise<void>;
};

/**
 * Stale-while-revalidate for the localStorage caches (movie details, book
 * cover lookups, cached cover images). Every read is served from the cache;
 * after each page load, this re-runs the network calls that produced each
 * entry — staggered with high jitter and a small concurrency cap so a fresh
 * visit never fires a burst at the third-party APIs — and refreshes the
 * entry (and the live page, when visible) if the source changed.
 */
export class CacheRevalidator {
  private static instance: CacheRevalidator | null = null;
  private tasks: RevalidateTask[] = [];
  private started = false;

  static getInstance(): CacheRevalidator {
    if (!CacheRevalidator.instance) {
      CacheRevalidator.instance = new CacheRevalidator();
    }
    return CacheRevalidator.instance;
  }

  register(key: string, run: () => Promise<void>): void {
    if (this.started) return;
    this.tasks.push({ key, run });
  }

  start(): void {
    if (this.started || this.tasks.length === 0) return;
    this.started = true;

    // High jitter: spread validations across the whole session (5s–2min)
    // instead of stampeding third-party APIs right after load.
    const scheduled = this.tasks
      .map((t) => ({ task: t, at: randomBetween(5000, 120000) }))
      .sort((a, b) => a.at - b.at);

    let cursor = 0;
    let inFlight = 0;
    const MAX_CONCURRENT = 3;

    const pump = () => {
      while (inFlight < MAX_CONCURRENT && cursor < scheduled.length) {
        const { task, at } = scheduled[cursor++];
        inFlight++;
        setTimeout(() => {
          task.run()
            .catch(() => {})
            .finally(() => {
              inFlight--;
              pump();
            });
        }, at);
      }
    };
    pump();
  }
}