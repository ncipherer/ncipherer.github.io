import { marked } from "marked";
import { formatStampDate } from "./passport";
import { configuredPhotos } from "./purpose-photos";
import { bookDetails, ensureCatalog, movieDetails } from "./catalog";
import { currentSite, noteVisibleOnSite } from "./site";

/** Random integer between min and max (inclusive). */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Run async work over a list with a bounded concurrency pool. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}


import type { Note } from "../types";
export type { Note };

export class NoteService {
  private static instance: NoteService;
  private notes: Note[] = [];
  private initialized: boolean = false;
  private contentPrefetchPromise: Promise<void> | null = null;

  private constructor() { }

  public static getInstance(): NoteService {
    if (!NoteService.instance) {
      NoteService.instance = new NoteService();
    }
    return NoteService.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const response = await fetch("/data/notes.json");
      const notesData = await response.json();

      // The same bundle is published to GitHub Pages and to Cloudflare Pages,
      // so which notes are on this site is settled from the host the reader
      // arrived on, once, here — before any page, tag cloud, search index or
      // prefetch can see the list. A note meant for the other site is not just
      // unlisted: it is absent, so its URL 404s rather than half-working.
      const site = currentSite();

      // Lazy loading: only parse metadata, do NOT fetch content here.
      // Content is fetched on-demand via fetchNoteContent().
      this.notes = notesData.notes
        .filter((note: Omit<Note, "content">) =>
          noteVisibleOnSite(note.sites, site),
        )
        .map((note: Omit<Note, "content">) => ({
          ...note,
          content: "", // empty until fetched
        }));

      this.initialized = true;
    } catch (error) {
      console.error("Error loading notes:", error);
      this.notes = [];
    }
  }

  public async fetchNoteContent(note: Note): Promise<string> {
    if (note.content) return note.content;
    try {
      const response = await fetch(`/data/${note.contentPath}`);
      if (!response.ok) throw new Error(`Failed to load content for note ${note.id}`);
      const content = await response.text();
      note.content = content; // cache on the object
      return content;
    } catch (error) {
      console.error(`Error loading content for note ${note.id}:`, error);
      return "Content could not be loaded.";
    }
  }

  /**
   * Lazily prefetch the full markdown content of every note in the
   * background so search (and the notes feed) can match against note
   * bodies without having visited each note first. Fetches are deferred
   * to idle time and throttled to a small concurrency pool, so opening
   * the notes page never fires a burst of 30+ simultaneous requests.
   * Content is cached per note, so re-runs are no-ops for loaded notes.
   */
  public prefetchAllContent(): Promise<void> {
    // Memoize the actual promise: callers that await this after the prefetch
    // has already started must still wait for the note bodies to be loaded,
    // not get an instantly-resolved promise (which broke first-search
    // content matching).
    if (!this.contentPrefetchPromise) {
      this.contentPrefetchPromise = this.prefetchWithIdle(() =>
        this.runContentPrefetch()
      );
    }
    return this.contentPrefetchPromise;
  }

  private async runContentPrefetch(): Promise<void> {
    await this.initialize();
    const notes = this.getAllNotes(true);
    await mapWithConcurrency(notes, 3, (note) => this.fetchNoteContent(note));
  }

  /**
   * Warm the note bodies so search and the notes feed can match against them.
   * Movie and book artwork comes from the build-time catalog and the lazy
   * <img> tags, so there is nothing else to fetch up front.
   */
  public prefetchAll(): void {
    this.prefetchAllContent();
  }

  private prefetchWithIdle(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      const run = () => {
        task()
          .catch(() => {})
          .then(() => resolve());
      };
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        // Jitter the start so the content and cover passes don't kick off in
        // the same tick and hit third-party APIs simultaneously.
        setTimeout(() => {
          (window as any).requestIdleCallback(run, { timeout: 3000 });
        }, randomBetween(0, 1200));
      } else {
        setTimeout(run, randomBetween(250, 1200));
      }
    });
  }

  /**
   * Glossary tooltips: replaces the CSS-only hover bubble with a positioned
   * popover that matches the width of the poem line it belongs to, so it
   * never spills past the line's left or right edge on narrow screens.
   * Works with hover, keyboard focus and tap (touch).
   */
  public setupGlossaryPopovers(element: HTMLElement): void {
    const terms = element.querySelectorAll<HTMLElement>("[data-tooltip]");
    if (!terms.length) return;
    document.body.classList.add("js-tooltips");

    let popover: HTMLDivElement | null = null;
    const getPopover = (): HTMLDivElement => {
      if (!popover) {
        popover = document.createElement("div");
        popover.className = "glossary-popover";
        document.body.appendChild(popover);
      }
      return popover;
    };

    const hide = () => {
      if (popover) popover.classList.remove("visible");
    };

    const show = (term: HTMLElement) => {
      const text = term.getAttribute("data-tooltip");
      if (!text) return;
      const p = getPopover();
      p.textContent = text;
      p.classList.add("visible");
      document.body.appendChild(p); // keep the popover above everything

      const termRect = term.getBoundingClientRect();
      const edge = 16;
      // Poem lines live inside blockquote <p>s — match the line's bounds.
      // Regular note links instead hug their own text width so they never
      // render as a skinny vertical strip.
      const lineEl = term.closest("blockquote p") as HTMLElement | null;

      if (lineEl) {
        const lr = lineEl.getBoundingClientRect();
        const width = Math.min(lr.width, window.innerWidth - edge * 2);
        let left = lr.left;
        left = Math.max(edge / 2, Math.min(left, window.innerWidth - width - edge / 2));
        p.style.width = `${width}px`;
        p.style.maxWidth = "";
        p.style.left = `${left}px`;
      } else {
        p.style.width = "max-content";
        p.style.maxWidth = `${window.innerWidth - edge * 2}px`;
        const w = p.getBoundingClientRect().width;
        let left = Math.min(termRect.left, window.innerWidth - w - edge / 2);
        left = Math.max(edge / 2, left);
        p.style.left = `${left}px`;
      }

      const popRect = p.getBoundingClientRect();
      let top = termRect.top - popRect.height - 10;
      if (top < edge / 2) top = termRect.bottom + 10;
      if (top + popRect.height > window.innerHeight - edge / 2) {
        top = Math.max(edge / 2, window.innerHeight - popRect.height - edge / 2);
      }
      p.style.top = `${top}px`;
    };

    // Taps fire a synthesized mouseenter (show) followed by click (toggle),
    // which made the popover flash on touch. Handle taps via pointerdown and
    // suppress the synthetic mouse events that follow within a short window.
    let lastTouchAt = 0;
    const isSyntheticAfterTouch = () => performance.now() - lastTouchAt < 800;

    terms.forEach((term) => {
      const isLink = term.tagName === "A";
      if (!isLink) {
        term.addEventListener("pointerdown", (e) => {
          if (e.pointerType === "touch") {
            lastTouchAt = performance.now();
            if (popover && popover.classList.contains("visible")) hide();
            else show(term);
          }
        });
      }
      term.addEventListener("mouseenter", () => {
        if (!isSyntheticAfterTouch()) show(term);
      });
      term.addEventListener("mouseleave", () => {
        if (!isSyntheticAfterTouch()) hide();
      });
      term.addEventListener("focus", () => show(term));
      term.addEventListener("blur", hide);
      if (!isLink) {
        term.addEventListener("click", (e) => {
          if (isSyntheticAfterTouch()) {
            e.preventDefault(); // already handled by pointerdown
            return;
          }
          if (popover && popover.classList.contains("visible")) hide();
          else show(term);
        });
      }
    });

    window.addEventListener("scroll", hide, { passive: true });
    window.addEventListener("resize", hide);
    document.addEventListener("click", (e) => {
      if (popover && !(e.target as HTMLElement).closest("[data-tooltip]")) hide();
    });
  }

  public getAllNotes(includeHidden: boolean = false): Note[] {
    return [...this.notes]
      .filter((note) => includeHidden || !note.hidden)
      .sort(
        (a, b) =>
          new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime(),
      );
  }

  public getNoteById(id: string): Note | undefined {
    return this.notes.find((note) => note.id === id);
  }

  public getNoteByBlogLink(blogLink: string): Note | undefined {
    return this.notes.find((note) => note.blogLink === blogLink);
  }

  public getUrlFromNote(note: Note): string {
    return `note/${note.blogLink}`;
  }

  public async getNotesByTags(tags: string[]): Promise<Note[]> {
    await this.initialize();
    return this.notes
      .filter(
        (note) => !note.hidden && tags.every((tag) => note.tags.includes(tag)),
      )
      .sort(
        (a, b) =>
          new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime(),
      );
  }

  public async getNotesByTag(tag: string): Promise<Note[]> {
    return this.getNotesByTags([tag]);
  }

  public getAdjacentNotes(currentNote: Note): {
    previous: Note | null;
    next: Note | null;
  } {
    const sortedNotes = this.getAllNotes();
    const currentIndex = sortedNotes.findIndex(
      (note) => note.id === currentNote.id,
    );

    return {
      previous:
        currentIndex < sortedNotes.length - 1
          ? sortedNotes[currentIndex + 1]
          : null,
      next: currentIndex > 0 ? sortedNotes[currentIndex - 1] : null,
    };
  }

  public parseMarkdown(content: string): string {
    // 1. Process glossary links [text](glossary:definition)
    let processedContent = content.replace(
      /\[([^\]]+)\]\(glossary:([^)]+)\)/g,
      (_match, text, definition) => {
        const escapedDefinition = definition.replace(/"/g, "&quot;").trim();
        return `<span class="glossary-term" data-tooltip="${escapedDefinition}">${text}</span>`;
      },
    );

    // 2. Process poetic focus highlights focus(text)
    // Note: This must handle cases where the inner text might contain glossary spans
    processedContent = processedContent.replace(
      /focus\(([^)]+)\)/g,
      (_match, text) => {
        return `<span class="poetic-focus">${text}</span>`;
      },
    );

    // 3. Process bare image directives: `<image 9-loss-curve-high.png>`.
    // These come from an editor that writes them instead of markdown image
    // syntax, so marked passed them through as an unknown tag and the chart
    // never appeared. Files live in /data/pics, so the name is enough.
    processedContent = processedContent.replace(
      /^[ \t]*<image\s+([A-Za-z0-9._-]+)>[ \t]*$/gm,
      (_match, file: string) => {
        const alt = file
          .replace(/\.[^.]+$/, "")
          .split(/[-_]/)
          .filter(Boolean)
          .join(" ");
        return `<img src="/data/pics/${file}" alt="${alt}" loading="lazy" decoding="async">`;
      },
    );

    const renderer = new marked.Renderer();
    renderer.link = (href, title, text) => {
      return `<a href="${href}" ${title ? `title="${title}"` : ""} target="_blank" rel="noopener noreferrer" data-tooltip="${href}">${text}</a>`;
    };
    return marked(processedContent, { renderer });
  }

  public async getTagFrequencies(): Promise<Map<string, number>> {
    await this.initialize();
    const tagFrequencies = new Map<string, number>();

    this.notes
      .filter((note) => !note.hidden) // Only count tags from visible notes
      .forEach((note) => {
        note.tags?.forEach((tag) => {
          tagFrequencies.set(tag, (tagFrequencies.get(tag) || 0) + 1);
        });
      });

    return tagFrequencies;
  }

  /** Escapes for both text nodes and double-quoted attributes. */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Each stamp sits a fraction of a degree off true, the way a hand-pressed
   * stamp never lands square. Cycled by index so it looks random without
   * being random (re-renders stay stable).
   */
  private static readonly PASSPORT_TILTS = [-0.8, 0.5, -0.3, 0.9, -0.6, 0.2];

  public renderBucketList(content: string): string {
    const lines = content.split("\n");

    interface BucketItem {
      title: string;
      imagePath: string;
      description: string;
      checked: boolean;
      /** The file's memory of the item: its `>` notes, plus any `!` line. */
      memory: string;
      /** Date of experience, written inside the checkbox as [YYYY-MM-DD]. */
      livedAt: string;
      /** Photo shipped in src/data/pics/purpose, if one matches. */
      photoUrls: string[];
    }

    interface ParsedItem {
      title: string;
      imagePath: string;
      descLines: string[];
      checked: boolean;
      memoryLines: string[];
      livedAt: string;
    }

    const items: BucketItem[] = [];
    const headerLines: string[] = [];
    let current: ParsedItem | null = null;
    let hasSeenItem = false;

    const flushItem = (): void => {
      if (current !== null) {
        items.push({
          title: current.title,
          imagePath: current.imagePath,
          description: current.descLines.join(" "),
          checked: current.checked,
          memory: [...current.descLines, ...current.memoryLines].join(" "),
          livedAt: current.livedAt,
          photoUrls: configuredPhotos(current.title, current.imagePath),
        });
        current = null;
      }
    };

    // The checkbox carries the lived state and, optionally, its date:
    //   - [ ] not lived
    //   - [x] lived, date not recorded
    //   - [2026-10-18] lived on that day
    const parseCheckbox = (
      line: string,
    ): { checked: boolean; livedAt: string; rest: string } => {
      const body = line.replace(/^[-*]\s+/, "");
      const marker = body.match(/^\[([^\]]*)\]\s*/);
      if (marker === null) return { checked: false, livedAt: "", rest: body };
      const inner = marker[1].trim();
      const dated = inner.match(/^(\d{4}-\d{2}-\d{2})$/);
      return {
        checked: dated !== null || /^[xX]$/.test(inner),
        livedAt: dated === null ? "" : dated[1],
        rest: body.slice(marker[0].length),
      };
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;

      if (trimmed.startsWith("> ") || trimmed === ">") {
        const descLine = trimmed.replace(/^>\s?/, "");
        if (hasSeenItem && current !== null) {
          current.descLines.push(descLine);
        } else {
          headerLines.push(descLine);
        }
      } else if (trimmed.startsWith("!")) {
        // A memory line: the story, and optionally the date it happened.
        // "! 2026-10-17 did it in the sea at Vagator"
        if (current !== null) {
          const body = trimmed.replace(/^!\s*/, "");
          const dated = body.match(/^(\d{4}-\d{2}-\d{2})\s*[·|:-]?\s*(.*)$/);
          if (dated !== null) {
            // Legacy syntax: only a lived item keeps its date.
            if (current.checked && current.livedAt === "") {
              current.livedAt = dated[1];
            }
            if (dated[2].trim() !== "") current.memoryLines.push(dated[2].trim());
          } else {
            current.memoryLines.push(body);
          }
        }
      } else if (
        trimmed.startsWith("- ") ||
        trimmed.startsWith("* ") ||
        /^- \[[^\]]*\]/.test(trimmed)
      ) {
        hasSeenItem = true;
        flushItem();

        const { checked, livedAt, rest } = parseCheckbox(trimmed);
        let raw = rest;
        let imagePath = "";
        const imgMatch = raw.match(/^(.+?)\s+\(([^)]+\.[a-zA-Z]{2,5}[^)]*)\)$/);
        if (imgMatch) {
          raw = imgMatch[1].trim();
          imagePath = imgMatch[2].trim();
        }
        raw = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
        current = {
          title: raw,
          imagePath,
          descLines: [],
          checked,
          memoryLines: [],
          livedAt,
        };
      } else if (/^\[[^\]]*\]/.test(trimmed)) {
        hasSeenItem = true;
        flushItem();

        const { checked, livedAt, rest } = parseCheckbox(trimmed);
        let raw = rest;
        let imagePath = "";
        const imgMatch = raw.match(/^(.+?)\s+\(([^)]+\.[a-zA-Z]{2,5}[^)]*)\)$/);
        if (imgMatch) {
          raw = imgMatch[1].trim();
          imagePath = imgMatch[2].trim();
        }
        raw = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
        current = {
          title: raw,
          imagePath,
          descLines: [],
          checked,
          memoryLines: [],
          livedAt,
        };
      }
    }

    flushItem();

    const headerHtml = headerLines.length > 0
      ? `<blockquote class="bucket-header-quote">\n${headerLines.join("<br>")}\n</blockquote>`
      : "";

    // Passport: one stamp per item, no photography — the type is the artwork,
    // which is also why this page no longer needs a grid of placeholder
    // images. A date belongs to a lived item, so it ships with the page only
    // beside a checked box; the browser only ever supplements it
    // (see setupBucketStamps).
    const stamps = items.map((item, i) => {
      const serial = String(i + 1).padStart(2, "0");
      const cleanDesc = item.description
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
      const tilt = NoteService.PASSPORT_TILTS[i % NoteService.PASSPORT_TILTS.length];
      // Only the markdown checkbox determines lived status; the date beside
      // it is when it happened, not a lived marker.
      const livedAt = item.livedAt;
      const lived = item.checked;

      // The card previews at most four cells — three photos plus a +N chip
      // beyond that — so a long list never shrinks each image past
      // readability. The full list rides on the card's dataset for the
      // modal's collage.
      const shown = item.photoUrls.slice(0, item.photoUrls.length > 4 ? 3 : 4);
      const more = item.photoUrls.length - shown.length;
      const cells = shown.length + (more > 0 ? 1 : 0);
      // Index 0 covers no photos, 1 a single fill — the rest name a shape.
      const photoShape = ["", "", " is-duo", " is-trio", " is-quad"][
        Math.min(cells, 4)
      ];

      const html = `
        <div class="passport-card${item.photoUrls.length > 0 ? " has-photo" : ""}" style="--stamp-tilt: ${tilt}deg">
          <button
            type="button"
            class="passport-stamp${lived ? " is-stamped" : ""}"
            data-stamp-title="${this.escapeHtml(item.title)}"
            data-stamp-checked="${item.checked ? "true" : "false"}"
            data-stamp-lived="${lived ? "true" : "false"}"
            data-stamp-lived-base="${this.escapeHtml(item.livedAt)}"
            data-stamp-memory-base="${this.escapeHtml(item.memory)}"
            data-stamp-photos-base="${this.escapeHtml(item.photoUrls.join("|"))}"
            aria-pressed="${lived ? "true" : "false"}"
          >
            <span class="passport-stamp-photos${photoShape}" aria-hidden="true">${shown
              .map((url) => `<span class="passport-stamp-photo" data-stamp-photo data-stamp-photo-base="${this.escapeHtml(url)}" style="background-image: url('${url}')"></span>`)
              .join("")}${more > 0 ? `<span class="passport-stamp-more">+${more}</span>` : ""}</span>
            <span class="passport-stamp-head">
              <span class="passport-stamp-serial" aria-hidden="true">№${serial}</span>
            </span>
            <span class="passport-stamp-title">${this.escapeHtml(item.title)}</span>
            ${cleanDesc !== ""
          ? `<span class="passport-stamp-note">${this.escapeHtml(cleanDesc)}</span>`
          : ""}

            <span class="passport-stamp-perf" aria-hidden="true"></span>
            <span class="passport-stamp-ink" aria-hidden="true">
              <span class="passport-stamp-ink-word">Lived</span>
              <time class="passport-stamp-date">${livedAt === "" ? "" : formatStampDate(livedAt)}</time>
            </span>
          </button>
        </div>
      `;

      return {
        html,
        lived,
        // Only a lived item carries a date; it names the year of its group.
        year: item.checked && item.livedAt !== "" ? item.livedAt.slice(0, 4) : "",
      };
    });

    // The passport reads as a ledger: a ruled line per year the stamp was
    // inked (newest first), then lived stamps with no date written, then
    // everything still ahead.
    const yearGroups = new Map<string, string[]>();
    const undatedStamps: string[] = [];
    const aheadStamps: string[] = [];
    for (const stamp of stamps) {
      if (stamp.year !== "") {
        const forYear = yearGroups.get(stamp.year) ?? [];
        forYear.push(stamp.html);
        yearGroups.set(stamp.year, forYear);
      } else if (stamp.lived) {
        undatedStamps.push(stamp.html);
      } else {
        aheadStamps.push(stamp.html);
      }
    }

    const ledgerRule = (label: string): string =>
      `<div class="passport-year" role="heading" aria-level="3">${this.escapeHtml(label)}</div>`;
    const ledger = [
      ...[...yearGroups.keys()]
        .sort()
        .reverse()
        .flatMap((year) => [
          ledgerRule(year),
          ...(yearGroups.get(year) ?? []),
        ]),
      ...(undatedStamps.length > 0
        ? [ledgerRule("Undated"), ...undatedStamps]
        : []),
      ...(aheadStamps.length > 0
        ? [ledgerRule("Still ahead"), ...aheadStamps]
        : []),
    ].join("");

    const totalCount = items.length;
    const doneCount = items.filter((it) => it.checked).length;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    return `
      ${headerHtml}
      <div class="passport">
        <div class="passport-head">
          <div class="passport-head-row">
            <span class="passport-label">Passport</span>
            <span class="passport-counter"><b data-passport-done>${doneCount}</b> / ${totalCount} stamped</span>
          </div>
          <div class="bucket-progress-bar">
            <div class="bucket-progress-fill" data-passport-fill style="width: ${pct}%"></div>
          </div>
          <p class="passport-hint">Things I mean to live. The lived ones carry the date they happened — click any stamp for the memory.</p>
        </div>
        <div class="passport-grid" data-passport-grid data-passport-total="${totalCount}">
          ${ledger}
        </div>
        <p class="passport-announce" role="status" aria-live="polite" data-passport-announce></p>
      </div>
    `;
  }

  public async renderFullNote(
    note: Note,
    activeTags: string[] = [],
  ): Promise<string> {
    // Ensure content is loaded
    const content = await this.fetchNoteContent(note);
    let contentHtml = "";
    if (note.blogLink === "screens") {
      contentHtml = await this.renderMovies(content);
    } else if (note.blogLink === "songs") {
      contentHtml = await this.renderSongs(content);
    } else if (note.blogLink === "paper-shelf") {
      contentHtml = await this.renderPaperShelf(content);
    } else if (note.blogLink === "books") {
      contentHtml = await this.renderBooks(content);
    } else if (note.blogLink === "recipes") {
      contentHtml = await this.renderRecipes(content);
    } else if (note.blogLink === "purpose") {
      contentHtml = this.renderBucketList(content);
    } else {
      contentHtml = this.parseMarkdown(content);
    }

    return `
      <div class="note-header">
         <div class="note-header-top">
            <h2>
              <a href="/${this.getUrlFromNote(note)}" data-link>
                ${note.pinned ? '<span class="pin-icon"><span class="y2k-hide-emoji">📌</span></span> ' : ""}${note.title}
              </a>
            </h2>
         </div>
         <div class="note-meta">
            <span class="reading-time"><span class="y2k-hide-emoji">⌛</span> ${note.readingTime}</span>
            <span class="publish-date"><span class="y2k-hide-emoji">🗓️</span> ${note.publishDate}</span>
            <div class="note-tags">
                ${note.tags.map((tag) => `<a href="/tag/${tag}" class="tag ${activeTags.includes(tag) ? "active" : ""}" data-link>${tag}</a>`).join("")}
            </div>
         </div>
      </div>
      <div class="note-content">${contentHtml}</div>
      <div class="feed-footer">
        <div class="separator-line"></div>
        <div class="separator-line"></div>
        <div class="separator-line"></div>
      </div>
    `;
  }

  // ── Unreachable legacy renderers ─────────────────────────────────────────
  // renderMovies/renderSongs/renderPaperShelf/renderBooks below are superseded
  // by the copies in pages/note.ts, which is the only place these notes are
  // rendered: the songs/screens/books/paper-shelf notes are all `hidden` in
  // notes.json, so this class's renderFullNote (used by the notes and tag
  // listings) never reaches them. Treat pages/note.ts as the source of truth.
  private async renderMovies(content: string): Promise<string> {
    await ensureCatalog();
    const lines = content.split("\n");
    const sections: { title: string; movies: any[] }[] = [];
    let currentSection: { title: string; movies: any[] } | null = null;
    let currentMovie: {
      title: string;
      year?: string;
      imdbID?: string;
      tmdbID?: string;
      reviewLines: string[];
      isSeen?: boolean;
      inTheatre?: boolean;
    } | null = null;

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine === "") return;

      if (line.startsWith("## ")) {
        // Save current movie if exists
        if (currentMovie && currentSection) {
          currentSection.movies.push({
            title: currentMovie.title,
            year: currentMovie.year,
            imdbID: currentMovie.imdbID,
            tmdbID: currentMovie.tmdbID,
            review: currentMovie.reviewLines.join("\n"),
            isSeen: currentMovie.isSeen,
            inTheatre: currentMovie.inTheatre,
          });
          currentMovie = null;
        }
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = { title: line.replace("## ", "").trim(), movies: [] };
      } else if (trimmedLine.startsWith(">")) {
        // This is a review line
        if (currentMovie) {
          currentMovie.reviewLines.push(trimmedLine.substring(1).trim());
        }
      } else if (currentSection) {
        // Save previous movie if exists
        if (currentMovie) {
          currentSection.movies.push({
            title: currentMovie.title,
            year: currentMovie.year,
            imdbID: currentMovie.imdbID,
            tmdbID: currentMovie.tmdbID,
            review: currentMovie.reviewLines.join("\n"),
            isSeen: currentMovie.isSeen,
            inTheatre: currentMovie.inTheatre,
          });
        }
        // Parse new movie line
        // A line can carry two tokens after the title — `Title (2019) (tt…)`.
        // Both have to be read: with only one group the lazy title swallows the
        // year, the catalog lookup misses, and the card renders with no poster.
        const match = trimmedLine.match(
          /^(?:\[([^\]]+)\]\s*|([✓✔])\s*)?(.+?)\s\(((?:tt\d+|tmdb\d+|\d{4}))\)(?:\s*\(((?:tt\d+|tmdb\d+|\d{4}))\))?(?:\s*\[([^\]]+)\])?$/,
        );
        if (match) {
          const prefixFlags = (match[1] || match[2] || "").toLowerCase();
          const suffixFlags = (match[6] || "").toLowerCase();
          const combinedFlags = prefixFlags + " " + suffixFlags;
          const isSeen = /x|v|✓|✔|t/.test(combinedFlags);
          const inTheatre = /t/.test(combinedFlags);
          const tokens = [match[4], match[5]].filter(Boolean) as string[];
          const idToken = tokens.find(
            (token) => token.startsWith("tt") || token.startsWith("tmdb"),
          );
          const yearToken = tokens.find(
            (token) => !token.startsWith("tt") && !token.startsWith("tmdb"),
          );
          const isImdbId = !!idToken && idToken.startsWith("tt");
          const isTmdbId = !!idToken && idToken.startsWith("tmdb");
          currentMovie = {
            title: match[3].trim(),
            year: yearToken,
            imdbID: isImdbId ? idToken : undefined,
            tmdbID: isTmdbId ? (idToken as string).replace("tmdb", "") : undefined,
            reviewLines: [],
            isSeen,
            inTheatre,
          };
        } else {
          currentMovie = null;
        }
      }
    });

    // Don't forget the last movie and section
    const finalMovie = currentMovie as {
      title: string;
      year?: string;
      imdbID?: string;
      tmdbID?: string;
      reviewLines: string[];
      isSeen?: boolean;
      inTheatre?: boolean;
    } | null;
    const finalSection = currentSection as {
      title: string;
      movies: any[];
    } | null;
    if (finalMovie && finalSection) {
      finalSection.movies.push({
        title: finalMovie.title,
        year: finalMovie.year,
        imdbID: finalMovie.imdbID,
        tmdbID: finalMovie.tmdbID,
        review: finalMovie.reviewLines.join("\n"),
        isSeen: finalMovie.isSeen,
        inTheatre: finalMovie.inTheatre,
      });
    }
    if (finalSection && !sections.includes(finalSection)) {
      sections.push(finalSection);
    }

    // Poster, year and director all come from the build-time catalog, so this
    // renders in one pass with no network calls.
    const renderedSections = sections.map((section) => {
        const movieCards = section.movies.map((movie: any) => {
            const cd = movieDetails(movie);
            const details = {
              title: cd && cd.title ? cd.title : movie.title,
              year: cd && cd.year ? cd.year : movie.year || "",
              director: cd && cd.director ? cd.director : "",
              poster: cd ? cd.poster : "",
            };

            const hasReview = movie.review && movie.review.trim() !== "";
            const seenInd =
              movie.isSeen && !movie.inTheatre
                ? '<span class="seen-indicator" title="Viewed">✓ Watched</span>'
                : "";
            const theatreInd = movie.inTheatre
              ? '<span class="theatre-indicator" title="Watched in Theatre">🍿✓ Theatre</span>'
              : "";
            const reviewInd = hasReview
              ? '<span class="review-indicator" title="Has a review">\u270d\ufe0f</span>'
              : "";

            return `
              <div class="movie-card ${hasReview ? "has-review" : ""}">
                ${reviewInd}
                <div class="movie-indicators">${seenInd}${theatreInd}</div>
                ${details.poster
                  ? `<img src="${details.poster}" alt="${details.title} poster" class="movie-poster" loading="lazy" decoding="async">`
                  : `<div class="movie-poster movie-poster-missing" aria-hidden="true"></div>`}
                <div class="movie-info">
                  <h3>${details.title}${details.year ? ` (${details.year})` : ""}</h3>
                  <p><strong>Director:</strong> ${details.director || "—"}</p>
                </div>
              </div>
            `;
        });
        return `
          <h3>${section.title}</h3>
          <div class="movie-grid">${movieCards.join("")}</div>
        `;
    });

    return renderedSections.join("");
  }

  private renderSongs(content: string): Promise<string> {
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const sections: {
      title: string;
      songs: { title: string; artist: string; url: string; videoId: string }[];
    }[] = [];
    let currentSection: {
      title: string;
      songs: { title: string; artist: string; url: string; videoId: string }[];
    } | null = null;

    lines.forEach((line) => {
      if (line.startsWith("## ")) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = { title: line.replace("## ", "").trim(), songs: [] };
      } else if (currentSection) {
        const parts = line.split("|").map((p) => p.trim());
        let title = "",
          artist = "",
          url = "";
        if (parts.length === 3) {
          title = parts[0];
          artist = parts[1];
          url = parts[2];
        } else if (parts.length === 2) {
          title = parts[0];
          artist = "";
          url = parts[1];
        } else {
          title = "";
          artist = "";
          url = line.trim();
        }

        const match = url.match(
          /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/,
        );
        const videoId = match && match[2].length === 11 ? match[2] : null;
        if (videoId) {
          currentSection.songs.push({ title, artist, url, videoId });
        }
      }
    });
    if (currentSection) {
      sections.push(currentSection);
    }

    const renderedSections = sections.map((section, sIndex) => {
      const songListItems = section.songs.map((song, index) => {
        return `
          <div class="song-list-item" 
               data-video-id="${song.videoId}" 
               data-title="${song.title.replace(/"/g, "&quot;")}" 
               data-artist="${song.artist.replace(/"/g, "&quot;")}" 
               data-section-index="${sIndex}" 
               data-song-index="${index}"
               data-section-songs='${JSON.stringify(section.songs.map((s) => ({ title: s.title, artist: s.artist, videoId: s.videoId }))).replace(/'/g, "&apos;")}'>
            <div class="sl-col-index">
              <span class="track-number">${index + 1}</span>
              <span class="play-icon-hover">▶</span>
            </div>
            <div class="sl-col-title" data-title="${song.title.replace(/"/g, "&quot;")}" data-artist="${song.artist.replace(/"/g, "&quot;")}">${song.title}</div>
            <div class="sl-col-artist">${song.artist || "Unknown Artist"}</div>
          </div>
        `;
      });

      const playAllBtn =
        section.songs.length > 0
          ? `<button class="play-all-btn" 
                   data-section-songs='${JSON.stringify(section.songs.map((s) => ({ title: s.title, artist: s.artist, videoId: s.videoId }))).replace(/'/g, "&apos;")}'>
             <span class="play-icon-small">▶</span> Play All
           </button>`
          : "";

      return `
        <div class="section-header">
          <div class="section-title-wrapper">
            <h3>${section.title}</h3>
            <span class="playlist-length">${section.songs.length} songs</span>
          </div>
          ${playAllBtn}
        </div>
        <div class="song-list">
          <div class="song-list-header-row">
            <div class="sl-col-index">#</div>
            <div class="sl-col-title">Title</div>
            <div class="sl-col-artist">Artist</div>
          </div>
          ${songListItems.join("")}
        </div>
      `;
    });

    return Promise.resolve(renderedSections.join(""));
  }

  private async renderPaperShelf(content: string): Promise<string> {
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const sections: {
      title: string;
      papers: { title: string; url: string; summary: string }[];
    }[] = [];
    let currentSection: {
      title: string;
      papers: { title: string; url: string; summary: string }[];
    } | null = null;

    lines.forEach((line) => {
      if (line.startsWith("## ")) {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = { title: line.replace("## ", "").trim(), papers: [] };
      } else if (currentSection) {
        const parts = line.split("|").map((p) => p.trim());
        if (parts.length >= 2) {
          currentSection.papers.push({
            title: parts[0],
            url: parts[1],
            summary: parts[2] || "",
          });
        }
      }
    });
    if (currentSection) {
      sections.push(currentSection);
    }

    const renderedSections = sections.map((section) => {
      const paperCards = section.papers.map((paper) => {
        return `
            <div class="paper-card">
              <div class="paper-info">
                <h3 class="paper-title">${paper.title}</h3>
                <p class="paper-summary">${paper.summary}</p>
                <a href="${paper.url}" target="_blank" class="paper-link">View Paper →</a>
              </div>
            </div>
          `;
      });

      return `
        <h3>${section.title}</h3>
        <div class="paper-grid">${paperCards.join("")}</div>
      `;
    });

    return Promise.resolve(renderedSections.join(""));
  }

  private async renderBooks(content: string): Promise<string> {
    const lines = content.split("\n");
    const sections: any[] = [];
    let currentSection: any = null;
    let currentBook: any = null;

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine === "") return;

      if (line.startsWith("## ")) {
        if (currentBook && currentSection) {
          currentSection.books.push({
            title: currentBook.title,
            review: currentBook.reviewLines.join("\n"),
            isRead: currentBook.isRead,
          });
          currentBook = null;
        }
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = { title: line.replace("## ", "").trim(), books: [] };
      } else if (trimmedLine.startsWith(">")) {
        if (currentBook) {
          currentBook.reviewLines.push(trimmedLine.substring(1).trim());
        }
      } else if (currentSection) {
        if (currentBook) {
          currentSection.books.push({
            title: currentBook.title,
            isbn: currentBook.isbn,
            review: currentBook.reviewLines.join("\n"),
            isRead: currentBook.isRead,
          });
        }
        const match = trimmedLine.match(/^(?:\[([ xX✓✔])\]\s*)?(.+)$/);
        if (match) {
          const isRead = match[1] && match[1].trim() !== "";
          let rawTitle = match[2].trim();
          let isbn = null;
          const isbnMatch = rawTitle.match(/\(([\d-]+)\)$/);
          if (isbnMatch) {
            isbn = isbnMatch[1].replace(/-/g, "");
            if (isbn.length >= 10 && isbn.length <= 13) {
              rawTitle = rawTitle.replace(isbnMatch[0], "").trim();
            } else {
              isbn = null;
            }
          }
          currentBook = {
            title: rawTitle,
            isbn: isbn,
            reviewLines: [],
            isRead: !!isRead,
          };
        } else {
          currentBook = null;
        }
      }
    });

    if (currentBook && currentSection) {
      currentSection.books.push({
        title: currentBook.title,
        isbn: currentBook.isbn,
        review: currentBook.reviewLines.join("\n"),
        isRead: currentBook.isRead,
      });
    }
    if (currentSection && !sections.includes(currentSection)) {
      sections.push(currentSection);
    }

    const renderedSections = await Promise.all(
      sections.map(async (section) => {
        const bookCards = await Promise.all(
          section.books.map((book: any) => {
            try {
              // Cover and author are resolved at build time into the catalog:
              // this used to be one Open Library request per book, spaced out
              // by a sleep to stay under the rate limit.
              const details = bookDetails(book);
              const finalData = {
                title: (details && details.title) || book.title,
                authors: (details && details.author) || "Unknown",
                poster: (details && details.cover) || "",
                rating: "N/A",
                found: !!(details && details.cover),
              };

              const hasReview = book.review && book.review.trim() !== "";
              const reviewClass = hasReview ? "has-review" : "";
              const reviewIndicator = hasReview
                ? '<span class="review-indicator" title="Has a review">\u270d\ufe0f</span>'
                : "";

              if (finalData.found) {
                return `
                  <div class="movie-card ${reviewClass}">
                    ${reviewIndicator}
                    <img src="${finalData.poster}" alt="${finalData.title} Cover" class="movie-poster" style="object-fit: cover;">
                    <div class="movie-info">
                      <h3>${finalData.title}</h3>
                      <p><strong>Author:</strong> ${finalData.authors}</p>
                      <p><strong>Rating:</strong> ${finalData.rating}</p>
                    </div>
                  </div>
                `;
              } else {
                return `
                  <div class="movie-card error">
                    <h3>${book.title}</h3>
                    <p>Could not load book details.</p>
                  </div>
                `;
              }
            } catch (error) {
              console.error("Error fetching book data:", error);
              return `
                  <div class="movie-card error">
                    <h3>${book.title}</h3>
                    <p>Error loading book details.</p>
                  </div>
                `;
            }
          }),
        );
        return `
          <h3>${section.title}</h3>
          <div class="movie-grid">${bookCards.join("")}</div>
        `;
      }),
    );

    return renderedSections.join("");
  }

  public async renderRecipes(content: string): Promise<string> {
    const lines = content.split("\n");
    const recipes: any[] = [];
    let currentRecipe: any = null;
    let currentSection: string | null = null;

    lines.forEach((line) => {
      const trimmedLine = line.trim();

      if (line.startsWith("# ")) {
        if (currentRecipe) {
          recipes.push(currentRecipe);
        }
        const titleText = line.replace("# ", "").trim();
        currentRecipe = { title: titleText, prepTime: "", cookTime: "", ingredients: [], instructions: [], notes: [] };
        currentSection = null;

      } else if (line.startsWith("### ") && currentRecipe && !currentSection) {
        // This is the time metadata line right after the recipe title
        // e.g. "### Prep: 10 mins | Cook: 15 mins" or "### Prep: 10 mins, Cook: 15 mins"
        const meta = line.replace(/^###\s+/, "").trim();
        const prepMatch = meta.match(/Prep:\s*([^|,]+)/i);
        const cookMatch = meta.match(/Cook:\s*([^|,]+)/i);
        if (prepMatch) currentRecipe.prepTime = prepMatch[1].trim();
        if (cookMatch) currentRecipe.cookTime = cookMatch[1].trim();

      } else if (line.startsWith("## ")) {
        currentSection = line.replace(/^##\s+/, "").trim().toLowerCase();

      } else if (line.startsWith("### ") && currentSection) {
        // sub-section inside a known section — treat as plain text
        currentSection = line.replace(/^###\s+/, "").trim().toLowerCase();

      } else if (trimmedLine !== "" && trimmedLine !== "---" && currentRecipe && currentSection) {
        if (currentSection === "ingredients") {
          currentRecipe.ingredients.push(trimmedLine.replace(/^- /, "").trim());
        } else if (currentSection === "instructions") {
          currentRecipe.instructions.push(trimmedLine.replace(/^\d+\.\s*/, "").trim());
        } else if (currentSection === "notes") {
          currentRecipe.notes.push(trimmedLine.replace(/^- /, "").trim());
        }
      }
    });

    if (currentRecipe) {
      recipes.push(currentRecipe);
    }

    const recipeCards = recipes.map((recipe, index) => {
      const ingredientsHtml = recipe.ingredients.map((ing: string) => `<li><span class="ingredient-checkbox"></span><span class="ingredient-text">${ing}</span></li>`).join("");

      const instructionsHtml = recipe.instructions.map((inst: string, i: number) => {
        let title = "";
        let duration = "";
        let description = inst;
        let tip = "";
        let label = "Tip";

        // Extract bold title at the start
        const boldMatch = description.match(/^\*\*(.*?)\*\*\s*(?:-\s*|:\s*|\s+)?/);
        if (boldMatch) {
          title = boldMatch[1];
          description = description.replace(boldMatch[0], "");
        }

        // Extract italic duration
        const italicMatch = description.match(/(?:\*|_)(\d+.*?)(?:\*|_)\s*(?:-\s*|:\s*|\s+)?/);
        if (italicMatch) {
          duration = italicMatch[1];
          description = description.replace(italicMatch[0], "");
        } else {
          const parenMatch = description.match(/\(([^)]*?min[^)]*?)\)\s*(?:-\s*|:\s*|\s+)?/i);
          if (parenMatch) {
            duration = parenMatch[1];
            description = description.replace(parenMatch[0], "");
          }
        }

        // Extract Tip/Note if exists (generic)
        const tipMatch = description.match(/(Tip|Note):\s*(.*)$/i);
        if (tipMatch) {
          label = tipMatch[1];
          tip = tipMatch[2];
          description = description.substring(0, tipMatch.index).trim();
        }

        description = description.trim().replace(/^[-\s:]+/, "").trim();

        // If no structured title could be extracted, use the whole thing as title and no description
        if (!title && !duration) {
          title = inst;
          description = "";
        }

        return `
          <li class="recipe-step">
            <div class="step-timeline">
              <span class="step-num">${i + 1}</span>
              <div class="step-line"></div>
            </div>
            <div class="step-content">
              ${title ? `<h4 class="step-title">${title}</h4>` : ""}
              ${duration ? `<span class="step-duration">${duration}</span>` : ""}
              ${description ? `<p class="step-description">${description}</p>` : ""}
              ${tip ? `<div class="step-tip"><span class="tip-label">${label}:</span> ${tip}</div>` : ""}
            </div>
          </li>
        `;
      }).join("");

      // Calculate total cook time if not explicitly provided
      let displayCookTime = recipe.cookTime;
      if (!displayCookTime && !recipe.prepTime && recipe.instructions.length > 0) {
        let minTotal = 0;
        let maxTotal = 0;

        recipe.instructions.forEach((inst: string) => {
          const durationMatch = inst.match(/(?:\*|_)(\d+(?:\s*-\s*\d+)?)\s*(min|hour|hr|h)/i);
          if (durationMatch) {
            const timeStr = durationMatch[1];
            const unit = durationMatch[2].toLowerCase();
            const multiplier = unit.startsWith("h") ? 60 : 1;

            const parts = timeStr.split("-").map(p => parseInt(p.trim()));
            if (parts.length === 2) {
              minTotal += parts[0] * multiplier;
              maxTotal += parts[1] * multiplier;
            } else if (parts.length === 1) {
              minTotal += parts[0] * multiplier;
              maxTotal += parts[0] * multiplier;
            }
          }
        });

        if (minTotal > 0) {
          const formatTime = (minutes: number) => {
            if (minutes >= 60) {
              const h = Math.floor(minutes / 60);
              const m = minutes % 60;
              return m > 0 ? `${h}h ${m}m` : `${h}h`;
            }
            return `${minutes} mins`;
          };

          if (minTotal === maxTotal) {
            displayCookTime = formatTime(minTotal);
          } else {
            displayCookTime = `${formatTime(minTotal)} - ${formatTime(maxTotal)}`;
          }
        }
      }

      // The card starts folded, exactly like a playlist on the songs page:
      // the reader sees a table of contents of dishes and opens one at a time
      // instead of scrolling past every ingredient list on the site.
      const recipeId = `recipe-${index}`;

      return `
        <div class="recipe-card collapsed" id="${recipeId}" data-recipe-card>
          <div class="recipe-title-bar">
            <button
              type="button"
              class="recipe-toggle"
              aria-expanded="false"
              aria-controls="${recipeId}-grid"
              aria-label="Expand ${this.escapeHtml(recipe.title)}"
            >
              <span class="recipe-chevron" aria-hidden="true">▾</span>
            </button>
            <h2 class="recipe-title">🍽️ ${recipe.title}</h2>
            <div class="recipe-times">
              ${recipe.prepTime ? `<span class="recipe-time-badge prep-time">💤⏰ Prep: ${recipe.prepTime}</span>` : ""}
              ${displayCookTime ? `<span class="recipe-time-badge cook-time">🕒 Cook: ${displayCookTime}</span>` : ""}
            </div>
          </div>
          <div class="recipe-grid" id="${recipeId}-grid" data-recipe-grid>
            <div class="recipe-ingredients">
              <h3>Ingredients</h3>
              <ul>${ingredientsHtml}</ul>
            </div>
            <div class="recipe-instructions">
              <h3>The Process</h3>
              <ol class="recipe-steps">${instructionsHtml}</ol>
            </div>
          </div>
        </div>
      `;
    });

    const sonarBanner = `
      <div class="recipe-sonar-banner">
        <span class="recipe-sonar-banner-icon">🎤</span>
        <div class="recipe-sonar-banner-text">
          <strong>Hands-free scroll.</strong> Enable sonar scroll from the mic button in the navbar — then wave your hand up or down in front of your device to scroll anywhere on the site.
        </div>
      </div>
    `;

    return sonarBanner + recipeCards.join("");
  }
}
