/**
 * Memory photos for the passport, read from src/data/pics/purpose.
 *
 * Same trick as the home film strip (see services/photo.ts): a webpack context
 * over the directory, so dropping a file in is the whole configuration step —
 * no JSON index to regenerate, no import to remember, and the build fails
 * loudly if the folder ever disappears.
 *
 * An item finds its photo by filename, matched against the item's title:
 *
 *   "Swim 1 km without stopping"  ->  swim-1-km-without-stopping.jpg
 *
 * The markdown can also name the file outright, which wins over the slug —
 * or name several, comma separated, for a collage:
 *
 *   - [ ] Swim 1 km without stopping (vagator-swim.jpg)
 *   - [ ] Swim 1 km without stopping (before.jpg, after.jpg, crew.jpg)
 *
 * Either way the photo is part of the site's content, so it ships with the
 * page; a photo picked in the browser is a local override on top of it.
 */

/** Filename slugs are derived, never hand-written: lowercase, dashes, ASCII. */
export function slugTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadContext(): Map<string, string> | null {
  try {
    // The pattern has to be a literal here, not a constant: webpack reads the
    // call statically to decide which files to bundle, and a variable makes it
    // give up ("critical dependency" warning) and bundle nothing.
    const context = (require as any).context(
      "../data/pics/purpose",
      false,
      /\.(jpe?g|png|webp|gif|avif)$/i,
    ) as {
      keys: () => string[];
      (key: string): string | { default?: string };
    };

    const photos = new Map<string, string>();
    for (const key of context.keys()) {
      const file = key.replace(/^\.\//, "");
      const loaded = context(key);
      const url = typeof loaded === "string"
        ? loaded
        : loaded?.default ?? `/data/pics/purpose/${file}`;
      // Index by full filename and by its stem, so the markdown can say
      // either "vagator-swim.jpg" or just "vagator-swim".
      photos.set(file.toLowerCase(), url);
      photos.set(file.replace(/\.[^./]+$/, "").toLowerCase(), url);
    }
    return photos;
  } catch {
    // No folder yet (or a bundler without require.context): no configured
    // photos is a perfectly good state, and the browser ones still work.
    return null;
  }
}

let cache: Map<string, string> | null | undefined;

function photos(): Map<string, string> | null {
  if (cache === undefined) cache = loadContext();
  return cache;
}

/** Resolve one declared name ("vagator.jpg" or "vagator") to its URL. */
function resolveDeclared(
  photosByName: Map<string, string>,
  name: string,
): string | null {
  const key = name.trim().toLowerCase();
  if (key === "") return null;
  return (
    photosByName.get(key) ??
    photosByName.get(key.replace(/\.[^./]+$/, "")) ??
    null
  );
}

/**
 * The photos the site ships for this item, in the order the markdown named
 * them. The parenthetical may list several files, comma separated:
 *
 *   - [ ] Swim 1 km (before.jpg, after.jpg, crew.jpg)
 *
 * Names that match nothing in the pics folder are dropped silently — a typo
 * loses that one photo, never the item, and a list where at least one name
 * resolves never falls back to the slug. With no parenthetical at all, the
 * slug of the title still finds the single photo it was built for.
 */
export function configuredPhotos(
  title: string,
  declaredFiles: string,
): string[] {
  const photosByName = photos();
  if (photosByName === null) return [];

  const declared = declaredFiles
    .split(",")
    .map((name) => resolveDeclared(photosByName, name))
    .filter((url): url is string => url !== null);
  if (declared.length > 0) {
    // The same file named twice (with and without its extension) is one photo.
    return Array.from(new Set(declared));
  }

  const bySlug = photosByName.get(slugTitle(title));
  return bySlug === undefined ? [] : [bySlug];
}

