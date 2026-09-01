# Purpose passport photos

Drop a photo in this folder and it becomes the memory behind an item on the
[Purpose](../../../?/) list. There is no index file to update — the folder is
read at build time (`src/services/purpose-photos.ts`).

## Naming

An item finds its photo by a slug of its own title:

| Item in `purpose.md`             | File here                             |
| -------------------------------- | ------------------------------------- |
| `Swim 1 km without stopping`     | `swim-1-km-without-stopping.jpg`      |
| `Ride 500 km on a bike`          | `ride-500-km-on-a-bike.jpg`           |

The slug is the title lowercased, with everything that is not a letter or a
digit turned into `-`. Quotes and punctuation are dropped, so
`Watch the universe with "Her"` becomes `watch-the-universe-with-her`.

Any of `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif` will do. If a title is
long, or you'd rather name the file something else, that is fine too — the
markdown can point at it directly and that name wins:

```md
- [ ] Swim 1 km without stopping (vagator-swim.jpg)
```

## Dates of experience

The checkbox carries the date of the experience, and only a lived item has one:

```md
- [ ] Swim 1 km without stopping                         not lived yet
- [x] Swim 1 km without stopping                         lived, date not recorded
- [2026-10-17] Swim 1 km without stopping                lived on 17 October 2026
```

Parentheses after the title are for photo filenames; a date in parentheses is
not read.

## Several photos

The parenthetical takes a comma-separated list, and each file becomes a cell
of the collage behind the stamp:

```md
- [ ] Swim 1 km without stopping (vagator-swim.jpg, after-swim.jpg, crew.jpg)
```

One photo fills the stamp as before; two sit side by side; three put the first
at full height on the left; four make a 2×2 sheet. Longer lists show the first
three plus a `+N` chip — the memory modal always shows all of them. Names that
match nothing here are simply dropped; a list where at least one name resolves
never falls back to the title slug.

## If two photos are eligible

The markdown's explicit filename wins. Beyond that, the slug is unique per
title, so there's nothing else to resolve.

## Why it lives here

`purpose.md` stays the list of intentions, and this folder holds what an item
looked like when it happened. Keeping them apart means the list is still easy to
read and diff, and the photographs are still just files — they build into the
site like every other asset instead of living in someone's browser.
