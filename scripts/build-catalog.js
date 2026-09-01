#!/usr/bin/env node
/**
 * Build the media catalog consumed by src/services/catalog.ts.
 *
 * Why this exists: the screens page used to call OMDB/TMDB from the browser,
 * which meant API keys shipped in the bundle and a cold visit made ~150
 * third-party requests. Resolving the artwork here instead means the browser
 * only ever reads /data/catalog.json. The books page used to call Open Library
 * from the browser for every cover and author; it is resolved here too.
 *
 * The merge is deliberately conservative:
 *   - an entry already in the catalog is never re-fetched and never dropped,
 *   - a missing/unreachable API (or no keys at all) leaves the catalog as it
 *     was, so `npm run build` still succeeds on a plane or in CI without
 *     secrets,
 *   - only genuinely new titles are resolved over the network.
 *
 * The catalog holds one record per film and one per book: entries are matched
 * by identity (IMDB id, ISBN, then title) and enriched in place, so a title can
 * never appear twice under two spellings of its name or year.
 *
 * Usage:
 *   node scripts/build-catalog.js            # merge, fetch only what's new
 *   node scripts/build-catalog.js --refresh  # re-fetch every title
 *   node scripts/build-catalog.js --dry-run  # report, write nothing
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const screensPath = path.join(root, "src", "data", "screens.md");
const booksPath = path.join(root, "src", "data", "books.md");
const catalogPath = path.join(root, "src", "data", "catalog.json");

const args = process.argv.slice(2);
const REFRESH = args.includes("--refresh");
const DRY_RUN = args.includes("--dry-run");

// Set whenever an entry is added or one of its fields changes, so a re-resolve
// that corrects an existing entry still gets written out (a bare key count
// would call that "up to date" and silently drop the fix).
let changed = false;

/* ------------------------------------------------------------------ env */

function loadEnv() {
  // Tiny .env reader — avoids depending on dotenv for a build hook.
  const envPath = path.join(root, ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const OMDB_KEY = env.OMDB_API_KEY;
const TMDB_KEY = env.TMDB_API_KEY;

/* --------------------------------------------------------------- parsing */

const normalizeTitle = (t) => t.toLowerCase().replace(/\s+/g, " ").trim();

/* -------------------------------------------------------------- identity */

// An IMDB id or an ISBN pins the record exactly. A title has to agree on year
// or director before it counts as the same title — this is what stops "No
// Other Choice" existing twice because OMDB dates it 2026 and TMDB 2025, while
// still keeping a remake (same title, different year *and* director) apart.
const MOVIE_FIELDS = ["title", "year", "director", "poster", "imdbID"];
const BOOK_FIELDS = ["title", "isbn", "author", "cover"];

function findMovie(movies, ref) {
  if (ref.imdbID) {
    const byId = movies.find((m) => m.imdbID === ref.imdbID);
    if (byId) return byId;
  }
  const want = normalizeTitle(ref.title);
  const sameTitle = movies.filter((m) => normalizeTitle(m.title) === want);
  if (!sameTitle.length) return null;
  if (!ref.year) return sameTitle[0];
  return (
    sameTitle.find((m) => m.year === ref.year) ||
    sameTitle.find((m) => !!m.director && m.director === ref.director) ||
    // A record we never managed to date is an incomplete version of this film.
    sameTitle.find((m) => !m.year) ||
    null
  );
}

function findBook(books, ref) {
  if (ref.isbn) {
    const byIsbn = books.find((b) => b.isbn === ref.isbn);
    if (byIsbn) return byIsbn;
  }
  const want = normalizeTitle(ref.title);
  return books.find((b) => normalizeTitle(b.title) === want) || null;
}

/**
 * Keep the catalog exactly in step with the pages: collapse records that turn
 * out to describe the same title, then drop records no page mentions any more.
 * Only ever called once a page has parsed cleanly, so a parse failure can never
 * empty the catalog — and a failed lookup never drops anything, because the
 * pages (not the lookups) decide what stays.
 */
function reconcile(records, refs, find, fields) {
  const kept = [];
  for (const record of records) {
    const twin = kept.find((other) => find([other], record) !== null);
    if (twin) merge(twin, record, fields);
    else kept.push(record);
  }

  const onPage = kept.filter((record) => refs.some((ref) => find([record], ref) !== null));
  const dropped = kept.filter((record) => !onPage.includes(record));
  if (dropped.length) {
    changed = true;
    console.log(
      `[catalog] dropped ${dropped.length} record(s) no longer on the page: ${dropped
        .map((record) => record.title)
        .join(", ")}`,
    );
  }
  return onPage;
}

// Fill the gaps and correct what we now know, but never blank a field out.
function merge(target, source, fields) {
  for (const field of fields) {
    const value = source[field];
    if (value && target[field] !== value) {
      target[field] = value;
      changed = true;
    }
  }
}

// Non-capturing on purpose: an inner group would shift the capture indexes
// below and every entry would read its own year twice, so the IMDB id written
// on the line was silently ignored.
const YEAR_OR_ID = "(?:tt\\d{6,}|tmdb\\d+|(?:19|20)\\d{2})";
// [mark] Title (year-or-id) (id)?
//   [x]  No other choice (2025) (tt1527793)
//   [x]  A Class Divided (tt0257489)
//   Two Years Later (2026) (tt37403273)     <- watchlist, no mark
const ENTRY_RE = new RegExp(
  `^(?:\\[([^\\]]*)\\]\\s+)?(.+?)\\s*\\((${YEAR_OR_ID})\\)\\s*(?:\\((${YEAR_OR_ID})\\))?\\s*$`,
);

function parseScreens(markdown) {
  const refs = [];
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    // Reviews and prose: blockquotes, headings, list items, tables, HTML.
    if (!line || /^[>#\-*|`]/.test(line) || line.includes("<a ")) continue;
    if (line.length > 140) continue; // a title line is never this long
    const m = line.match(ENTRY_RE);
    if (!m) continue;

    const [, , title, first, second] = m;
    const token = (t) => {
      if (!t) return null;
      if (t.startsWith("tt")) return { imdbID: t };
      if (t.startsWith("tmdb")) return { tmdbID: t.slice(4) };
      return { year: t };
    };
    const a = token(first) || {};
    const b = token(second) || {};
    const year = a.year || b.year || undefined;
    const imdbID = a.imdbID || b.imdbID;
    const tmdbID = a.tmdbID || b.tmdbID;
    if (!title || (!year && !imdbID && !tmdbID)) continue;

    refs.push({ title: title.trim(), year, imdbID, tmdbID });
  }
  return refs;
}

// Same shape the page renders: `[x] Title (isbn)` or `Title (isbn)` between
// `## section` headings, with `>` lines as the review.
function parseBooks(markdown) {
  const refs = [];
  const seen = new Set();
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line || /^[>#\-*|`]/.test(line) || line.includes("<a ")) continue;
    if (line.length > 140) continue;
    const m = line.match(/^(?:\[([^\]]*)\]\s*)?(.+)$/);
    if (!m) continue;

    let title = m[2].trim();
    let isbn = null;
    const isbnMatch = title.match(/\(([\d-]+)\)$/);
    if (isbnMatch) {
      const digits = isbnMatch[1].replace(/-/g, "");
      if (digits.length >= 10 && digits.length <= 13) {
        isbn = digits;
        title = title.replace(isbnMatch[0], "").trim();
      }
    }
    if (!title) continue;
    const key = normalizeTitle(title);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ title, isbn });
  }
  return refs;
}

/* -------------------------------------------------------------- lookups */

async function getJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

const poster = (p) => (p && p !== "N/A" ? p : "");
const clean = (v) => (v && v !== "N/A" ? v : "");

/**
 * Does this artwork URL still resolve to an image?
 *
 * Amazon drops old poster files, and OMDB keeps handing out the dead link —
 * four titles were serving 404s that the browser rendered as a broken image.
 * A HEAD request tells us (404 + text/plain vs 200 + image/jpeg), so the build
 * can fall back to the other source and, failing that, ship no URL at all and
 * let the page draw its placeholder plate.
 */
async function posterWorks(url) {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return false;
    return (res.headers.get("content-type") || "").startsWith("image/");
  } catch {
    return false;
  }
}

async function fromOmdb(ref) {
  if (!OMDB_KEY) return null;
  const params = new URLSearchParams({ apikey: OMDB_KEY, plot: "short" });
  if (ref.imdbID) params.set("i", ref.imdbID);
  else {
    params.set("t", ref.title);
    if (ref.year) params.set("y", ref.year);
  }
  const data = await getJSON(`https://www.omdbapi.com/?${params}`);
  if (!data || data.Response === "False") return null;
  // When we searched by name rather than by id, the answer has to really be
  // this title — otherwise the odd similar-named film wins by search rank.
  if (!ref.imdbID && clean(data.Title) && normalizeTitle(clean(data.Title)) !== normalizeTitle(ref.title)) {
    return null;
  }
  return {
    title: clean(data.Title) || ref.title,
    year: clean(data.Year).slice(0, 4) || ref.year || "",
    director: clean(data.Director),
    poster: poster(data.Poster),
    imdbID: clean(data.imdbID) || ref.imdbID,
  };
}

/**
 * TMDB, resolved by identity rather than by search.
 *
 * A title search is not an identity: "Sunday" answers "First Sunday" (a
 * different film), "Party" answers "The Party" (1980), and a series answers
 * with a film that happens to share its name — which is how a TV show ended up
 * wearing a movie poster. So the tmdb id on the line or the IMDB id (via the
 * keyless /find endpoint) decides which work this is, both film and series are
 * considered, and the search is a last resort that must agree on the title.
 */
async function tmdbMovie(id) {
  const data = await getJSON(`https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_KEY}`);
  if (!data || !data.id) return null;
  return {
    kind: "movie",
    id: data.id,
    title: clean(data.title),
    date: clean(data.release_date),
    poster: data.poster_path,
  };
}

async function tmdbTv(id) {
  const data = await getJSON(`https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_KEY}`);
  if (!data || !data.id) return null;
  return {
    kind: "tv",
    id: data.id,
    title: clean(data.name),
    date: clean(data.first_air_date),
    poster: data.poster_path,
    creator: data.created_by && data.created_by[0] ? data.created_by[0].name : "",
  };
}

async function tmdbByImdbId(imdbID) {
  const found = await getJSON(
    `https://api.themoviedb.org/3/find/${imdbID}?api_key=${TMDB_KEY}&external_source=imdb_id`,
  );
  if (!found) return null;
  const movie = (found.movie_results || [])[0];
  if (movie) {
    return {
      kind: "movie",
      id: movie.id,
      title: clean(movie.title),
      date: clean(movie.release_date),
      poster: movie.poster_path,
    };
  }
  const tv = (found.tv_results || [])[0];
  if (tv) {
    return {
      kind: "tv",
      id: tv.id,
      title: clean(tv.name),
      date: clean(tv.first_air_date),
      poster: tv.poster_path,
    };
  }
  return null;
}

async function tmdbBySearch(ref) {
  const want = normalizeTitle(ref.title);
  const kinds = [
    { kind: "movie", name: "title", date: "release_date", yearParam: "year" },
    { kind: "tv", name: "name", date: "first_air_date", yearParam: "first_air_date_year" },
  ];
  for (const { kind, name, date, yearParam } of kinds) {
    const params = new URLSearchParams({ api_key: TMDB_KEY, query: ref.title });
    if (ref.year) params.set(yearParam, ref.year);
    const data = await getJSON(`https://api.themoviedb.org/3/search/${kind}?${params}`);
    const hit = (data && data.results ? data.results : []).find(
      (r) =>
        normalizeTitle(r[name] || "") === want ||
        normalizeTitle(r.original_title || r.original_name || "") === want,
    );
    if (!hit) continue;
    return {
      kind,
      id: hit.id,
      title: clean(hit[name]),
      date: clean(hit[date]),
      poster: hit.poster_path,
    };
  }
  return null;
}

async function fromTmdb(ref) {
  if (!TMDB_KEY) return null;

  let entity = null;
  if (ref.tmdbID) entity = (await tmdbMovie(ref.tmdbID)) || (await tmdbTv(ref.tmdbID));
  if (!entity && ref.imdbID) entity = await tmdbByImdbId(ref.imdbID);
  if (!entity) entity = await tmdbBySearch(ref);
  if (!entity) return null;

  // A series credits its creator where a film credits its director.
  let director = entity.creator || "";
  if (!director && entity.kind === "movie") {
    const credits = await getJSON(
      `https://api.themoviedb.org/3/movie/${entity.id}/credits?api_key=${TMDB_KEY}`,
    );
    const crew = credits && credits.crew;
    if (crew) {
      const d = crew.find((c) => c.job === "Director");
      if (d) director = d.name;
    }
  }

  return {
    title: entity.title || ref.title,
    year: entity.date.slice(0, 4) || ref.year || "",
    director,
    poster: entity.poster ? `https://image.tmdb.org/t/p/w500${entity.poster}` : "",
    imdbID: ref.imdbID || "",
  };
}

/**
 * The cover belonging to this exact ISBN, or "" when there isn't one.
 * Open Library answers a missing cover with a tiny placeholder image, which is
 * why the size is checked rather than trusting the 200.
 */
async function isbnCover(isbn) {
  const url = `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`;
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return "";
    const type = res.headers.get("content-type") || "";
    const size = Number(res.headers.get("content-length") || 0);
    if (!type.startsWith("image/")) return "";
    if (size && size < 2000) return "";
    return url;
  } catch {
    return "";
  }
}

/**
 * Open Library, keyless. The cover of the edition the page names wins: a title
 * or ISBN search will happily hand back a *different* edition's artwork (the
 * first "When We Cease to Understand the World" hit is an orange cover, not the
 * black one the page is talking about). The search is still the source for the
 * author, and the fallback for anything without its own cover.
 */
async function fromOpenLibrary(book) {
  const ownCover = book.isbn ? await isbnCover(book.isbn) : "";

  const queries = [];
  if (book.isbn) queries.push(`isbn:${book.isbn}`);
  queries.push(`intitle:${book.title}`);

  let author = "";
  let searchedCover = "";
  for (const query of queries) {
    const data = await getJSON(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&fields=author_name,cover_i&limit=1`,
    );
    const doc = data && data.docs && data.docs[0];
    if (!doc) continue;
    if (!author && doc.author_name && doc.author_name[0]) author = doc.author_name[0];
    if (!searchedCover && doc.cover_i) {
      searchedCover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
    }
    if (author && searchedCover) break;
  }

  const cover = ownCover || searchedCover;
  if (!author && !cover) return null;
  return { title: book.title, author, cover };
}

/* ----------------------------------------------------------------- main */

// Everything below is async, and the awaits must not sit at module scope:
// top-level await makes Node re-parse this file as an ES module, which then
// fails on `require`. Keep it inside main().
async function resolveMovies(refs, movies) {
  const had = movies.length;

  // Resolved means the artwork was checked, not that artwork was found — a
  // title with no poster anywhere would otherwise be re-fetched every build.
  const already = (ref) => {
    if (REFRESH) return false;
    const hit = findMovie(movies, ref);
    return !!(hit && hit.checked);
  };

  const todo = refs.filter((ref) => !already(ref));
  console.log(
    `[catalog] movies: ${refs.length} titles on the page · ${had} in catalog · ${todo.length} to resolve`,
  );

  let added = 0;
  let missed = 0;
  const network = !!(OMDB_KEY || TMDB_KEY);

  for (const ref of todo) {
    if (!network) {
      missed++;
      continue;
    }

    // Already listed with artwork that still loads — verify once, then leave
    // it. A refresh deliberately skips this, so an entry the page identifies
    // by id is re-resolved from that id even when its stored art still loads.
    const existing = REFRESH ? null : findMovie(movies, ref);
    if (existing && (await posterWorks(existing.poster))) {
      existing.checked = true;
      changed = true;
      added++;
      process.stdout.write(`\r[catalog] checked ${added}/${todo.length} movies   `);
      continue;
    }

    // A tmdb id on the line is an exact reference, so use it before asking
    // OMDB to search by name.
    let entry = null;
    if (ref.tmdbID && !ref.imdbID) entry = await fromTmdb(ref);
    if (!entry && (ref.imdbID || OMDB_KEY)) entry = await fromOmdb(ref);
    if (!entry || (!entry.poster && !entry.director)) {
      entry = (await fromTmdb(ref)) || entry;
    }
    if (!entry) {
      missed++;
      continue;
    }
    // The page owns the name: a lookup may answer with a different spelling
    // (OMDB calls "Life of Chuck" "The Life of Chuck"), and storing that would
    // both rename the page and stop the record matching its own title next run.
    const record = {
      title: ref.title,
      year: ref.year || entry.year || "",
      director: entry.director || "",
      poster: entry.poster || "",
      imdbID: entry.imdbID || ref.imdbID || "",
    };
    // A dead artwork URL is worse than none: take the other source's poster,
    // and if that is missing too, ship no URL so the page draws its plate.
    if (process.env.CATALOG_DEBUG) {
      console.warn(`[catalog] ${ref.title} (${ref.year || ref.imdbID || ref.tmdbID || "?"}) -> ${entry.title} (${entry.year})`);
    }
    // The source we used may have no artwork at all (OMDB lists whole series
    // with no poster, and keeps handing out dead Amazon links), so ask the
    // other one and keep whatever actually loads. Failing that, ship no URL and
    // let the page draw its plate — a wrong or broken poster is worse.
    if (!record.poster || !(await posterWorks(record.poster))) {
      const alt = await fromTmdb(ref);
      record.poster = alt && alt.poster && (await posterWorks(alt.poster)) ? alt.poster : "";
      if (!record.director && alt && alt.director) record.director = alt.director;
    }
    record.checked = true;

    const target = findMovie(movies, ref) || findMovie(movies, record);
    if (target) merge(target, record, MOVIE_FIELDS);
    else {
      movies.push(record);
      changed = true;
    }
    if (target && !target.checked) {
      target.checked = true;
      changed = true;
    }
    added++;
    process.stdout.write(`\r[catalog] resolved ${added}/${todo.length} movies   `);
  }
  if (todo.length && network) process.stdout.write("\n");

  if (!network && missed) {
    console.warn(
      `[catalog] no OMDB_API_KEY/TMDB_API_KEY available — kept the ${had} cached movie entries and skipped ${missed} new title(s)`,
    );
  }

  // Worth knowing about: these render as a plain card with no artwork (and are
  // retried on the next build).
  const unmapped = refs.filter((ref) => {
    const hit = findMovie(movies, ref);
    return !hit || !hit.poster;
  });
  if (unmapped.length && network) {
    console.warn(`[catalog] no artwork yet for: ${unmapped.map((ref) => ref.title).join(", ")}`);
  }
}

async function resolveBooks(refs, books) {
  const had = books.length;

  // Both halves matter: an entry with a cover but no author is worth retrying.
  const already = (ref) => {
    if (REFRESH) return false;
    const hit = findBook(books, ref);
    return !!(hit && hit.cover && hit.author);
  };

  const todo = refs.filter((book) => !already(book));
  console.log(
    `[catalog] books: ${refs.length} on the page · ${had} in catalog · ${todo.length} to resolve`,
  );

  let added = 0;
  let missed = 0;

  for (const book of todo) {
    const entry = await fromOpenLibrary(book);
    if (!entry) {
      missed++;
      continue;
    }
    const record = {
      title: book.title,
      isbn: book.isbn || "",
      author: entry.author || "",
      cover: entry.cover || "",
    };
    const target = findBook(books, book);
    if (target) merge(target, record, BOOK_FIELDS);
    else {
      books.push(record);
      changed = true;
    }
    added++;
    process.stdout.write(`\r[catalog] resolved ${added}/${todo.length} books   `);
  }
  if (todo.length) process.stdout.write("\n");

  const unmapped = refs.filter((ref) => {
    const hit = findBook(books, ref);
    return !hit || !hit.cover;
  });
  if (unmapped.length) {
    console.warn(
      `[catalog] kept the ${had} cached book entries — no cover for: ${unmapped
        .map((ref) => ref.title)
        .join(", ")}`,
    );
  }
}

async function main() {
  let existing = { movies: [], books: [] };
  if (fs.existsSync(catalogPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
      if (parsed && Array.isArray(parsed.movies) && Array.isArray(parsed.books)) {
        existing = { movies: parsed.movies, books: parsed.books };
      } else if (parsed && typeof parsed === "object") {
        console.warn(
          "[catalog] catalog.json is in an older shape (keyed by alias) — rebuilding it from the pages",
        );
      }
    } catch (err) {
      console.warn(`[catalog] existing catalog unreadable (${err.message}) — rebuilding`);
    }
  }

  // One record per film, one per book.
  let movies = [...existing.movies];
  let books = [...existing.books];
  const hadMovies = movies.length;
  const hadBooks = books.length;

  // Each page is guarded on its own, so a broken or missing one can never stop
  // the other from being resolved.
  if (!fs.existsSync(screensPath)) {
    console.warn("[catalog] src/data/screens.md missing — leaving the movie entries untouched");
  } else {
    const refs = parseScreens(fs.readFileSync(screensPath, "utf8"));
    if (refs.length < 20) {
      console.warn(
        `[catalog] only ${refs.length} titles parsed from screens.md — leaving the movie entries untouched`,
      );
    } else {
      await resolveMovies(refs, movies);
      movies = reconcile(movies, refs, findMovie, MOVIE_FIELDS);
    }
  }

  if (!fs.existsSync(booksPath)) {
    console.warn("[catalog] src/data/books.md missing — leaving the book entries untouched");
  } else {
    const refs = parseBooks(fs.readFileSync(booksPath, "utf8"));
    if (refs.length < 3) {
      console.warn(
        `[catalog] only ${refs.length} books parsed from books.md — leaving the book entries untouched`,
      );
    } else {
      await resolveBooks(refs, books);
      books = reconcile(books, refs, findBook, BOOK_FIELDS);
    }
  }

  const count = movies.length;
  const bookCount = books.length;
  console.log(`[catalog] movies: ${hadMovies} -> ${count} · books: ${hadBooks} -> ${bookCount}`);
  // A short catalog means something upstream went wrong, not that the site got
  // smaller. Never write a file that would blank a page out.
  if (!count || !bookCount) {
    console.warn(`[catalog] refusing to write an empty catalog (${count} movies, ${bookCount} books)`);
    return;
  }

  if (DRY_RUN) {
    console.log(`[catalog] dry run — would write ${count} movies and ${bookCount} books`);
    return;
  }

  if (!changed) {
    console.log(`[catalog] up to date (${count} movies, ${bookCount} books)`);
    return;
  }

  // A stable order keeps a regenerated catalog's diff readable.
  movies.sort(
    (a, b) => a.title.localeCompare(b.title) || String(a.year).localeCompare(String(b.year)),
  );
  books.sort((a, b) => a.title.localeCompare(b.title));

  fs.writeFileSync(
    catalogPath,
    JSON.stringify({ movies, books, generated: new Date().toISOString().slice(0, 10) }, null, 2) +
      "\n",
  );
  const moviesWithArt = movies.filter((m) => m.poster).length;
  const booksWithArt = books.filter((b) => b.cover).length;
  console.log(
    `[catalog] wrote ${count} movies (${moviesWithArt} with artwork) and ${bookCount} books (${booksWithArt} with covers)`,
  );
}

// A network hiccup must never fail the build — the cached catalog is enough.
main().catch((err) => {
  console.warn(`[catalog] skipped (${err && err.message ? err.message : err})`);
});
