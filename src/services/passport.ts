/**
 * What the passport remembers in the browser.
 *
 * One thing only: which items have been lived since the site was built. The
 * list itself — an item's wording, its note, its memory, its date and its photo
 * — is authored in purpose.md and src/data/pics/purpose, so none of it is
 * stored here, and there is nothing for a reader to type or upload.
 *
 * (version bump: v2 records are {title: {livedAt}}. v1, a bare title→ISO map,
 * is still read so nothing stamped before this change is lost.)
 */

const RECORDS_KEY = "encipherer.purpose.passport.v2";
const LEGACY_KEY = "encipherer.purpose.passport.v1";

export interface PassportRecord {
  /**
   * ISO timestamp of the day the item was lived. An empty string is a
   * deliberate "not lived", which is how a date written in the file gets undone
   * without deleting the file's line.
   */
  livedAt?: string;
}

/**
 * "17 OCT 2026", the way a stamp reads.
 *
 * A bare `YYYY-MM-DD` (what the markdown carries) is parsed as a local date on
 * purpose: `new Date("2026-10-17")` is UTC midnight, which renders as the 16th
 * for anyone far enough west of Greenwich.
 */
export function formatStampDate(iso: string): string {
  const dateOnly = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly === null
    ? new Date(iso)
    : new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    );
  if (Number.isNaN(date.getTime())) return "";
  return date
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase();
}

export class PassportStore {
  private static instance: PassportStore | null = null;

  public static getInstance(): PassportStore {
    if (PassportStore.instance === null) {
      PassportStore.instance = new PassportStore();
    }
    return PassportStore.instance;
  }

  public readRecords(): Record<string, PassportRecord> {
    const records: Record<string, PassportRecord> = {};

    try {
      const raw = window.localStorage.getItem(RECORDS_KEY);
      if (raw !== null) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === "object") {
          for (const [title, value] of Object.entries(
            parsed as Record<string, unknown>,
          )) {
            if (value === null || typeof value !== "object") continue;
            const livedAt = (value as Record<string, unknown>).livedAt;
            if (typeof livedAt === "string") records[title] = { livedAt };
          }
          return records;
        }
      }
    } catch {
      // Unreadable storage: fall through and try the older shape.
    }

    try {
      const legacy = window.localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        const parsed: unknown = JSON.parse(legacy);
        if (parsed !== null && typeof parsed === "object") {
          for (const [title, iso] of Object.entries(
            parsed as Record<string, unknown>,
          )) {
            if (typeof iso === "string") records[title] = { livedAt: iso };
          }
        }
      }
    } catch {
      // Nothing to migrate.
    }

    return records;
  }

  /** Returns false when storage refused the write (private mode, full quota). */
  public writeRecords(records: Record<string, PassportRecord>): boolean {
    try {
      window.localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
      return true;
    } catch {
      return false;
    }
  }
}
