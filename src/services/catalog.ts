/**
 * Media catalog.
 *
 * src/data/catalog.json is generated at build time by scripts/build-catalog.js
 * (see the `prebuild` script in package.json). The browser only ever reads this
 * file, so no third-party API keys ship in the bundle, a cold visit makes zero
 * calls to OMDB/TMDB, and the books page needs no Open Library lookups for its
 * covers or authors.
 *
 * The file holds one record per film and one per book. Lookup indexes are built
 * once on load, so a page can ask for a title without knowing how the catalog
 * decided to store it.
 */

export type MovieEntry = {
  title: string;
  year: string;
  director: string;
  poster: string;
  imdbID: string;
};

export type MovieRef = {
  title: string;
  year?: string;
  imdbID?: string;
  tmdbID?: string;
};

export type BookEntry = {
  title: string;
  isbn: string;
  author: string;
  cover: string;
};

export type BookRef = {
  title: string;
  isbn?: string | null;
};

type Catalog = {
  generated?: string;
  movies: MovieEntry[];
  books: BookEntry[];
};

let catalog: Catalog | null = null;
let pending: Promise<Catalog> | null = null;

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * A title with its year still glued on — "Dune (2021)" — which is how a page
 * line is written. Records never store it that way, so it is stripped before
 * matching; otherwise the lookup misses and the card renders without artwork.
 */
function bareTitle(title: string): string {
  return normalizeTitle(title).replace(/\s*\((?:19|20)\d{2}\)$/, "");
}

/* --------------------------------------------------------------- lookups */

type Indexes = {
  moviesByImdb: Map<string, MovieEntry>;
  moviesByTitle: Map<string, MovieEntry>;
  booksByIsbn: Map<string, BookEntry>;
  booksByTitle: Map<string, BookEntry>;
};

let indexes: Indexes | null = null;

function firstWins(map: Map<string, unknown>, key: string, value: unknown): void {
  if (key && !map.has(key)) map.set(key, value);
}

function buildIndexes(data: Catalog): Indexes {
  const moviesByImdb = new Map<string, MovieEntry>();
  const moviesByTitle = new Map<string, MovieEntry>();
  const booksByIsbn = new Map<string, BookEntry>();
  const booksByTitle = new Map<string, BookEntry>();

  for (const movie of data.movies) {
    if (movie.imdbID) firstWins(moviesByImdb, movie.imdbID, movie);
    const title = bareTitle(movie.title);
    // Both spellings point at the same record: a caller that knows the year
    // gets the exact film, a caller that doesn't still gets an answer. The
    // first record wins, so a remake listed later can never shadow an earlier
    // film of the same name.
    firstWins(moviesByTitle, `${title}|${movie.year || ""}`, movie);
    firstWins(moviesByTitle, title, movie);
  }

  for (const book of data.books) {
    if (book.isbn) firstWins(booksByIsbn, book.isbn, book);
    firstWins(booksByTitle, bareTitle(book.title), book);
  }

  return { moviesByImdb, moviesByTitle, booksByIsbn, booksByTitle };
}

/**
 * Load (once) the generated catalog. Never rejects — an empty catalog renders
 * plain cards and cloth-coloured books instead.
 */
export async function ensureCatalog(): Promise<Catalog> {
  if (catalog) return catalog;
  if (!pending) {
    pending = fetch("/data/catalog.json")
      .then((res) => (res.ok ? res.json() : { movies: [], books: [] }))
      .catch(() => ({ movies: [], books: [] }))
      .then((data: Catalog) => {
        catalog = {
          movies: Array.isArray(data && data.movies) ? data.movies : [],
          books: Array.isArray(data && data.books) ? data.books : [],
        };
        indexes = buildIndexes(catalog);
        return catalog;
      });
  }
  return pending;
}

/**
 * Details for one movie line, or null when the catalog has nothing for it.
 * Candidates are tried in order of how precisely they identify the film —
 * IMDB id, then title + year, then title alone — and the first one with
 * artwork wins so a bare record can't hide a complete one.
 */
export function movieDetails(movie: MovieRef): MovieEntry | null {
  if (!indexes) return null;
  const title = bareTitle(movie.title);
  const candidates = [
    movie.imdbID ? indexes.moviesByImdb.get(movie.imdbID) : undefined,
    indexes.moviesByTitle.get(`${title}|${movie.year || ""}`),
    indexes.moviesByTitle.get(title),
  ].filter((entry): entry is MovieEntry => !!entry);

  return candidates.find((entry) => entry.poster) || candidates[0] || null;
}

/**
 * Cover and author for one book, or null when the catalog has nothing for it.
 * The ISBN pins the edition the page names; the title is the fallback.
 */
export function bookDetails(book: BookRef): BookEntry | null {
  if (!indexes) return null;
  const candidates = [
    book.isbn ? indexes.booksByIsbn.get(book.isbn) : undefined,
    indexes.booksByTitle.get(bareTitle(book.title)),
  ].filter((entry): entry is BookEntry => !!entry);

  return candidates.find((entry) => entry.cover) || candidates[0] || null;
}

/** Test seam: is a catalog loaded yet? */
export function catalogLoaded(): boolean {
  return catalog !== null;
}
