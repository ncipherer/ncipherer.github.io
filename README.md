# encipherer's whispers

A personal site that is mostly writing, plus a few toys built out of the same
material: a terminal you can browse it with, a movie shelf with reviews, a
songs page, a bucket list.

Published at **https://ncipherer.github.io** via GitHub Pages.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

```bash
npm run build        # → dist/
npm run preview      # serve dist/ locally
npm run typecheck    # tsc --noEmit (the build already type-checks via ts-loader)
```

There are no environment variables to set for a normal run. The only script
that wants secrets is the optional movie-catalog refresh (below), and it fails
soft without them.

## How the content works

Everything you read on the site lives in `src/data/` as markdown, and
`src/data/notes.json` is the index that decides what is published where.

| What | Where | Rendered by |
| --- | --- | --- |
| Essays and notes | `src/data/*.md` + an entry in `notes.json` | `marked`, via `services/note.ts` |
| Movie reviews | `src/data/screens.md` | `renderMovies` (poster grid + review modals) |
| Songs | `src/data/songs.md` | `renderSongs` (list + YouTube player) |
| Books | `src/data/books.md` | `renderBooks` (bookshelf carousel) |
| Recipes | `src/data/recipe.md` | `renderRecipes` |
| Bucket list | `src/data/purpose.md` | `renderBucketList` (checkboxes + progress) |
| Photo gallery | `src/data/pics/home/*` | `components/carousel.ts` (the markdown is just the caption) |

Markdown has three extras beyond plain CommonMark:

- `[text](glossary:definition)` renders a `text` with a definition popover.
- `focus(text)` highlights a phrase (used in the poems).
- `<cite>— Author</cite>` renders an attribution line.

### Publishing a note

1. Write `src/data/my-note.md`.
2. Add an entry to `src/data/notes.json`:

   ```json
   {
     "id": "33",
     "title": "My note",
     "readingTime": "6 min",
     "publishDate": "2026-09-16",
     "blogLink": "my-note",
     "githubLink": "",
     "hidden": false,
     "pinned": false,
     "links": [],
     "tags": ["philosophy"],
     "contentPath": "my-note.md"
   }
   ```

`blogLink` becomes the URL (`/note/my-note`), `tags` become `/tag/<tag>` pages,
and `pinned: true` puts the note in the collections row at the top of `/notes`
(`hidden: true` + `pinned: true` is how the collections themselves — Screens,
Songs, Books — are kept out of the main feed).

Two rules worth keeping: a note that is `hidden` **and** not `pinned` can't be
reached from anywhere, and a `contentPath` must point at a file that actually
ships. The build-catalog script and the repo's history both say the same thing:
delete drafts instead of leaving them in the index.

### Adding a movie, book or song

- **Movie**: add a line to `src/data/screens.md` as
  `Title (Year)` — optionally `[x]`/`[✓]` for watched, a trailing `[t]` for
  seen in a theatre, `(tt1234567)` for an exact IMDb match. Then run
  `npm run build:catalog`.
- **Book**: add `Title (ISBN)` to `src/data/books.md`. Covers come from Open
  Library, so an ISBN is what gets you artwork.
- **Song**: add `Title | Artist | https://www.youtube.com/watch?v=…` to the
  right section in `src/data/songs.md`. Keep it to exactly three fields — the
  player splits on `|`.

## The movie catalog (why it exists)

`screens.md` holds ~75 titles. The poster, year and director for each one are
resolved **at build time** into `src/data/catalog.json` by
`scripts/build-catalog.js`:

```bash
npm run build:catalog            # fill in anything missing (needs .env keys)
npm run build:catalog -- --refresh   # re-resolve every title
```

`npm run build` runs this automatically, so a configured machine keeps the
catalog fresh. Without `OMDB_API_KEY` / `TMDB_API_KEY` it exits quietly and
reuses what is already committed — which is why a fresh clone builds fine with
no `.env` at all.

This is the reason the browser never talks to OMDB or TMDB: no API key ships in
the bundle, and a cold visit makes zero third-party requests instead of ~75.

```
.env (optional, gitignored)
  TMDB_API_KEY=…
  OMDB_API_KEY=…
```

## Deploying

`main` is deployed by `.github/workflows/deploy.yml`: `npm ci` → typecheck →
build → upload `dist/` to GitHub Pages. The workflow writes `.env` from
repository secrets so the catalog can be refreshed on a machine that has them.

`npm run deploy` (gh-pages branch) still works if you'd rather publish manually.
`_redirects` exists for Netlify-style hosts; `.nojekyll` keeps GitHub Pages from
processing the output.

## Layout

```
public/
  .nojekyll            disables Jekyll on GitHub Pages
  favicon.ico          site icon copied to root of dist/
  404.html, _redirects, cursor SVGs, sw.js
src/
  main.ts              app boot: router, theme, search, audio, sonar
  router.ts            tiny pushState router (/ , /notes, /note/:slug, /tag/:tag)
  pages/               one file per route
  components/          search modal, terminal, carousel, bioscope, tag cloud
  services/            notes + catalog data, player, caches, audio, sonar
  types/               shared TypeScript domain models & interfaces
  styles/              stylesheets (base tokens/shell, components, pages, themes)
    main.css           the only CSS entry point; imports everything else
  data/                all content (markdown, notes.json, catalog.json, pics)
scripts/
  build-catalog.js     screens.md → catalog.json
  build-verify-harness.js  inlines dist into a single offline .html for manual checks
```

CSS load order in `src/styles/main.css` **is** the cascade — moving an import can
change which rule wins.

## Notes for whoever works on this next

- `tsconfig.json` is `strict`, plus `noUnusedLocals` / `noUnusedParameters`.
  An unused function fails the build, which is intentional.
- Three themes: `dark`, `light` (warm paper, not an inversion) and
  `y2k-cyber` (CRT scanlines, chrome bevels). The Y2K theme is scoped almost
  entirely to `src/styles/themes/y2k-overhaul.css`, so it can be changed without
  touching the default look.
- Sound is on for desktop and off by default on touch devices; `prefers-reduced-motion`
  disables the animations across the site.
- Note bodies are lazy-loaded and prefetched at idle time so search can match
  full text. `services/catalog.ts` is the only other data fetch.
