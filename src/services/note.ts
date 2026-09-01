import { marked } from "marked";

async function fetchFromTMDB(
  title: string,
  year?: string,
  imdbID?: string,
  tmdbID?: string,
  existingDirector?: string
): Promise<{ title: string; year: string; director: string; poster: string } | null> {
  const apiKey = process.env.TMDB_API_KEY;
  let movieData: any = null;
  let isTV = false;

  try {
    // 1. If we have a tmdbID, fetch movie/tv details directly
    if (tmdbID) {
      const url = `https://api.themoviedb.org/3/movie/${tmdbID}?api_key=${apiKey}`;
      const res = await fetch(url);
      if (res.ok) {
        movieData = await res.json();
        isTV = false;
      } else {
        const tvUrl = `https://api.themoviedb.org/3/tv/${tmdbID}?api_key=${apiKey}`;
        const tvRes = await fetch(tvUrl);
        if (tvRes.ok) {
          movieData = await tvRes.json();
          isTV = true;
        }
      }
    }

    // 2. If no movieData yet but we have an imdbID, find it (tries movie then tv)
    if (!movieData && imdbID) {
      const url = `https://api.themoviedb.org/3/find/${imdbID}?api_key=${apiKey}&external_source=imdb_id`;
      const res = await fetch(url);
      if (res.ok) {
        const findData = await res.json();
        if (findData.movie_results && findData.movie_results.length > 0) {
          movieData = findData.movie_results[0];
          isTV = false;
        } else if (findData.tv_results && findData.tv_results.length > 0) {
          movieData = findData.tv_results[0];
          isTV = true;
        }
      }
    }

    // 3. If no movieData yet, search by title and year
    if (!movieData) {
      let url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(title)}`;
      if (year && /^\d{4}$/.test(year)) {
        url += `&primary_release_year=${year}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const searchData = await res.json();
        if (searchData.results && searchData.results.length > 0) {
          movieData = searchData.results[0];
          isTV = false;
        }
      }

      if (!movieData) {
        let tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(title)}`;
        if (year && /^\d{4}$/.test(year)) {
          tvUrl += `&first_air_date_year=${year}`;
        }
        const tvRes = await fetch(tvUrl);
        if (tvRes.ok) {
          const searchData = await tvRes.json();
          if (searchData.results && searchData.results.length > 0) {
            movieData = searchData.results[0];
            isTV = true;
          }
        }
      }
    }

    // 4. If we found movieData, extract the fields and return details
    if (movieData) {
      const movieTitle = isTV
        ? (movieData.name || movieData.original_name || title)
        : (movieData.title || movieData.original_title || title);
      const releaseDate = isTV
        ? (movieData.first_air_date || "")
        : (movieData.release_date || "");
      const movieYear = releaseDate ? releaseDate.split("-")[0] : (year || "");
      const posterPath = movieData.poster_path;
      const poster = posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : "";

      // Just use the existing director or fallback to N/A
      const director = existingDirector && existingDirector !== "Unknown" ? existingDirector : "N/A";

      return {
        title: movieTitle,
        year: movieYear,
        director,
        poster
      };
    }
  } catch (error) {
    console.error("Error fetching from TMDB:", error);
  }

  return null;
}

/** Random integer between min and max (inclusive). */
function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Sleep a random amount to spread requests out and avoid API throttling. */
function jitteredDelay(minMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randomBetween(minMs, maxMs)));
}

/**
 * Run async work over a list with a bounded concurrency pool. Each item is
 * preceded by a jittered delay so concurrent workers don't fire their
 * requests in lockstep (which is exactly what trips rate limiters).
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
  jitterMinMs: number = 0,
  jitterMaxMs: number = 0,
): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (index < items.length) {
      const item = items[index++];
      if (jitterMaxMs > 0) await jitteredDelay(jitterMinMs, jitterMaxMs);
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}


export interface Note {
  id: string;
  title: string;
  content: string;
  readingTime: string;
  githubLink?: string;
  publishDate: string;
  tags: string[];
  contentPath?: string;
  blogLink: string;
  links?: Array<{ url: string; description: string }>;
  pinned?: boolean;
  hidden?: boolean; // Add this field
}

export class NoteService {
  private static instance: NoteService;
  private notes: Note[] = [];
  private initialized: boolean = false;
  private contentPrefetchPromise: Promise<void> | null = null;
  private coversPrefetchStarted: boolean = false;

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

      // Lazy loading: only parse metadata, do NOT fetch content here.
      // Content is fetched on-demand via fetchNoteContent().
      this.notes = notesData.notes.map((note: Omit<Note, "content">) => ({
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
   * Warm every movie and book cover in the background so the Screens and
   * Books pages render with their artwork already in the cache. Movie
   * details go into the same localStorage cache the movie grid reads, and
   * cover images are preloaded so the browser HTTP cache holds them.
   */
  public prefetchAllCovers(): void {
    if (this.coversPrefetchStarted) return;
    this.coversPrefetchStarted = true;
    this.prefetchWithIdle(() => this.runCoversPrefetch());
  }

  /** Kick off both the note-content prefetch and the cover prefetch. */
  public prefetchAll(): void {
    this.prefetchAllContent();
    this.prefetchAllCovers();
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

  private async runCoversPrefetch(): Promise<void> {
    await this.initialize();

    const screensNote = this.notes.find((n) => n.blogLink === "screens");
    if (screensNote) {
      const content = await this.fetchNoteContent(screensNote);
      const movies = this.parseMovies(content);
      await mapWithConcurrency(movies, 3, (movie) => this.warmMovieCover(movie), 150, 450);
    }

    const booksNote = this.notes.find((n) => n.blogLink === "books");
    if (booksNote) {
      const content = await this.fetchNoteContent(booksNote);
      const books = this.parseBooks(content);
      await mapWithConcurrency(books, 3, (book) => this.warmBookCover(book), 150, 450);
    }
  }

  private parseMovies(
    content: string,
  ): { title: string; year?: string; imdbID?: string; tmdbID?: string }[] {
    const movies: { title: string; year?: string; imdbID?: string; tmdbID?: string }[] = [];
    const lineRe = /^(?:\[([^\]]+)\]\s*|([✓✔])\s*)?(.+?)\s\((tt\d+|tmdb\d+|\d{4})\)(?:\s*\[([^\]]+)\])?$/;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(">") || trimmed.startsWith("##")) continue;
      const match = trimmed.match(lineRe);
      if (!match) continue;
      const isImdbId = match[4].startsWith("tt");
      const isTmdbId = match[4].startsWith("tmdb");
      movies.push({
        title: match[3].trim(),
        year: !isImdbId && !isTmdbId ? match[4] : undefined,
        imdbID: isImdbId ? match[4] : undefined,
        tmdbID: isTmdbId ? match[4].replace("tmdb", "") : undefined,
      });
    }
    return movies;
  }

  private parseBooks(content: string): { title: string; isbn: string | null }[] {
    const books: { title: string; isbn: string | null }[] = [];
    const lineRe = /^(?:\[([ xX\u2713\u2714])\]\s*)?(.+)$/;
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(">") || trimmed.startsWith("##")) continue;
      const match = trimmed.match(lineRe);
      if (!match) continue;
      let rawTitle = match[2].trim();
      let isbn: string | null = null;
      const isbnMatch = rawTitle.match(/\(([\d-]+)\)$/);
      if (isbnMatch) {
        const candidate = isbnMatch[1].replace(/-/g, "");
        if (candidate.length >= 10 && candidate.length <= 13) {
          isbn = candidate;
          rawTitle = rawTitle.replace(isbnMatch[0], "").trim();
        }
      }
      books.push({ title: rawTitle, isbn });
    }
    return books;
  }

  private async warmMovieCover(movie: {
    title: string;
    year?: string;
    imdbID?: string;
    tmdbID?: string;
  }): Promise<void> {
    const cacheKey = movie.imdbID
      ? `movie_imdb_${movie.imdbID}`
      : `movie_title_${movie.title}_${movie.year}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const cd = JSON.parse(cached);
        if (cd && cd.poster && cd.poster !== "N/A") return;
      } catch {
        // fall through to refetch
      }
    }

    const omdbUrl = movie.imdbID
      ? `https://www.omdbapi.com/?i=${movie.imdbID}&apikey=${process.env.OMDB_API_KEY}`
      : `https://www.omdbapi.com/?t=${encodeURIComponent(movie.title)}&y=${movie.year}&apikey=${process.env.OMDB_API_KEY}`;

    // Jittered pause before hitting the API so a burst doesn't trip rate limits.
    await jitteredDelay(150, 500);

    try {
      const res = await fetch(omdbUrl);
      if (!res.ok) throw new Error("OMDB request failed");
      const data = await res.json();
      if (data.Response === "True" && data.Poster && data.Poster !== "N/A") {
        const entry = {
          title: data.Title || movie.title,
          year: data.Year || movie.year,
          director: data.Director || "Unknown",
          poster: data.Poster,
        };
        localStorage.setItem(cacheKey, JSON.stringify(entry));
        await this.preloadImage(entry.poster);
        return;
      }
      const tmdbData = await fetchFromTMDB(
        movie.title,
        movie.year,
        movie.imdbID,
        movie.tmdbID,
        data.Director || "Unknown",
      );
      if (tmdbData && tmdbData.poster) {
        const entry = {
          title: tmdbData.title,
          year: tmdbData.year,
          director: tmdbData.director,
          poster: tmdbData.poster,
        };
        localStorage.setItem(cacheKey, JSON.stringify(entry));
        await this.preloadImage(entry.poster);
      }
    } catch {
      try {
        const tmdbData = await fetchFromTMDB(movie.title, movie.year, movie.imdbID, movie.tmdbID);
        if (tmdbData && tmdbData.poster) {
          const entry = {
            title: tmdbData.title,
            year: tmdbData.year,
            director: tmdbData.director,
            poster: tmdbData.poster,
          };
          localStorage.setItem(cacheKey, JSON.stringify(entry));
          await this.preloadImage(entry.poster);
        }
      } catch {
        // ignore
      }
    }
  }

  private async warmBookCover(book: { title: string; isbn: string | null }): Promise<void> {
    if (book.isbn) {
      await this.preloadImage(`https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`);
      return;
    }
    const cacheKey = `book_cover_${book.title}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      await this.preloadImage(cached);
      return;
    }
    await jitteredDelay(150, 500);
    try {
      const res = await fetch(`https://openlibrary.org/search.json?q=intitle:${encodeURIComponent(book.title)}`);
      if (!res.ok) return;
      const data = await res.json();
      const info = data && data.docs && data.docs[0];
      if (info && info.cover_i) {
        const url = `https://covers.openlibrary.org/b/id/${info.cover_i}-M.jpg`;
        localStorage.setItem(cacheKey, url);
        await this.preloadImage(url);
      }
    } catch {
      // ignore
    }
  }

  private preloadImage(url: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
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

  public renderBucketList(content: string): string {
    const lines = content.split("\n");

    interface BucketItem {
      title: string;
      imagePath: string;
      description: string;
      checked: boolean;
    }

    interface ParsedItem {
      title: string;
      imagePath: string;
      descLines: string[];
      checked: boolean;
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
        });
        current = null;
      }
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
      } else if (
        trimmed.startsWith("- ") ||
        trimmed.startsWith("* ") ||
        /^- \[[ x]\]/.test(trimmed)
      ) {
        hasSeenItem = true;
        flushItem();

        const checked = /^\[[xX]\]/.test(trimmed.replace(/^[-*]\s+/, ""));
        let raw = trimmed
          .replace(/^[-*]\s+/, "")
          .replace(/^\[[ xX]\]\s*/, "");
        let imagePath = "";
        const imgMatch = raw.match(/^(.+?)\s+\(([^)]+\.[a-zA-Z]{2,5}[^)]*)\)$/);
        if (imgMatch) {
          raw = imgMatch[1].trim();
          imagePath = imgMatch[2].trim();
        }
        raw = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
        current = { title: raw, imagePath, descLines: [], checked };
      } else if (/^\[[ xX]\]/.test(trimmed)) {
        hasSeenItem = true;
        flushItem();

        const checked = /^\[[xX]\]/.test(trimmed);
        let raw = trimmed.replace(/^\[[ xX]\]\s*/, "");
        let imagePath = "";
        const imgMatch = raw.match(/^(.+?)\s+\(([^)]+\.[a-zA-Z]{2,5}[^)]*)\)$/);
        if (imgMatch) {
          raw = imgMatch[1].trim();
          imagePath = imgMatch[2].trim();
        }
        raw = raw.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
        current = { title: raw, imagePath, descLines: [], checked };
      }
    }

    flushItem();

    const PLACEHOLDER = "https://placehold.net/default.svg";

    const headerHtml = headerLines.length > 0
      ? `<blockquote class="bucket-header-quote">\n${headerLines.join("<br>")}\n</blockquote>`
      : "";

    const cards = items.map((item, i) => {
      const itemId = `bucket-item-${i}`;
      const hasDesc = item.description.trim() !== "";
      const imgSrc = item.imagePath || PLACEHOLDER;
      const cleanDesc = item.description.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

      return `
        <div class="bucket-card ${item.checked ? "has-desc" : ""}" data-bucket-id="${itemId}" onclick="document.getElementById('${itemId}').style.display='flex';" style="cursor: pointer;">
          ${item.checked ? `<div class="bucket-card-completed">✓ Completed</div>` : ""}
          <div class="bucket-card-img-wrap">
            <img src="${imgSrc}" alt="${item.title}" class="bucket-card-img" onerror="this.src='${PLACEHOLDER}'">
            <div class="bucket-card-overlay">
              <span class="bucket-card-zoom">🔍 View</span>
            </div>
          </div>
          <div class="bucket-card-body">
            <h3 class="bucket-card-title">${item.title}</h3>
          </div>
        </div>
        <div class="bucket-modal" id="${itemId}" style="display:none;">
          <div class="bucket-modal-backdrop" onclick="this.parentElement.style.display='none';"></div>
          <div class="bucket-modal-content">
            <button type="button" class="bucket-modal-close" onclick="this.closest('.bucket-modal').style.display='none';">&times;</button>
            <div class="bucket-modal-inner">
              <div class="bucket-modal-left">
                <img src="${imgSrc}" alt="${item.title}" class="bucket-modal-img" onerror="this.src='${PLACEHOLDER}'">
              </div>
              <div class="bucket-modal-right">
                <h2 class="bucket-modal-title">${item.title}</h2>
                <div class="bucket-modal-experience">
                  ${hasDesc
          ? `<p>${cleanDesc.replace(/\n/g, "<br>")}</p>`
          : `<p class="bucket-modal-empty">Unlived. Soon!</p>`}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    });

    const doneCount = items.filter((it) => it.checked).length;
    const totalCount = items.length;
    const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

    return `
      ${headerHtml}
      <div class="bucket-progress">
        <div class="bucket-progress-bar">
          <div class="bucket-progress-fill" style="width: ${pct}%"></div>
        </div>
        <span class="bucket-progress-label">${doneCount} / ${totalCount} experienced</span>
      </div>
      <div class="bucket-grid">
        ${cards.join("")}
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

  private async renderMovies(content: string): Promise<string> {
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
        const match = trimmedLine.match(
          /^(?:\[([^\]]+)\]\s*|([✓✔])\s*)?(.+?)\s\((tt\d+|tmdb\d+|\d{4})\)(?:\s*\[([^\]]+)\])?$/,
        );
        if (match) {
          const prefixFlags = (match[1] || match[2] || "").toLowerCase();
          const suffixFlags = (match[5] || "").toLowerCase();
          const combinedFlags = prefixFlags + " " + suffixFlags;
          const isSeen = /x|v|✓|✔|t/.test(combinedFlags);
          const inTheatre = /t/.test(combinedFlags);
          const isImdbId = match[4].startsWith("tt");
          const isTmdbId = match[4].startsWith("tmdb");
          currentMovie = {
            title: match[3].trim(),
            year: !isImdbId && !isTmdbId ? match[4] : undefined,
            imdbID: isImdbId ? match[4] : undefined,
            tmdbID: isTmdbId ? match[4].replace("tmdb", "") : undefined,
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

    const renderedSections = await Promise.all(
      sections.map(async (section) => {
        const movieCards = await Promise.all(
          section.movies.map(async (movie: any) => {
            let movieDetails = {
              title: movie.title,
              year: movie.year || "",
              director: "Unknown",
              poster: ""
            };
            let gotDetails = false;

            try {
              let url = "";
              if (movie.imdbID) {
                url = `https://www.omdbapi.com/?i=${movie.imdbID}&apikey=${process.env.OMDB_API_KEY}`;
              } else {
                url = `https://www.omdbapi.com/?t=${encodeURIComponent(movie.title)}&y=${movie.year}&apikey=${process.env.OMDB_API_KEY}`;
              }
              const response = await fetch(url);
              const data = await response.json();

              if (data.Response === "True") {
                movieDetails.title = data.Title || movie.title;
                movieDetails.year = data.Year || movie.year || "";
                movieDetails.director = data.Director || "Unknown";
                if (data.Poster && data.Poster !== "N/A") {
                  movieDetails.poster = data.Poster;
                  gotDetails = true;
                }
              }
            } catch (error) {
              console.error("Error fetching movie data from OMDB in service:", error);
            }

            // Fallback to TMDB if OMDB failed or had no poster
            if (!gotDetails) {
              const tmdbData = await fetchFromTMDB(movie.title, movie.year, movie.imdbID, movie.tmdbID, movieDetails.director);
              if (tmdbData) {
                movieDetails.title = tmdbData.title || movieDetails.title;
                movieDetails.year = tmdbData.year || movieDetails.year;
                if (tmdbData.director && tmdbData.director !== "Unknown") {
                  movieDetails.director = tmdbData.director;
                }
                if (tmdbData.poster) {
                  movieDetails.poster = tmdbData.poster;
                }
                gotDetails = true;
              }
            }

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
                <img src="${movieDetails.poster}" alt="${movieDetails.title} Poster" class="movie-poster">
                <div class="movie-info">
                  <h3>${movieDetails.title} (${movieDetails.year})</h3>
                  <p><strong>Director:</strong> ${movieDetails.director}</p>
                </div>
              </div>
            `;
          }),
        );
        return `
          <h3>${section.title}</h3>
          <div class="movie-grid">${movieCards.join("")}</div>
        `;
      }),
    );

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
          section.books.map(async (book: any, bookIndex: number) => {
            try {
              let finalData = {
                title: book.title,
                authors: "Unknown",
                poster: "",
                rating: "N/A",
                found: false,
                description: "",
              };

              // Helper sleep function for rate limiting (≈3 requests/sec)
              const sleep = (ms: number) =>
                new Promise((resolve) => setTimeout(resolve, ms));

              // Fetch book data from OpenLibrary API
              const url = book.isbn
                ? `https://openlibrary.org/search.json?isbn=${book.isbn}`
                : `https://openlibrary.org/search.json?q=intitle:${encodeURIComponent(book.title)}`;

              // Apply delay based on the book index to respect rate limit
              await sleep(bookIndex * 350); // 350ms ≈ 3 req/sec
              const response = await fetch(url);
              const data = await response.json();

              if (data.docs && data.docs.length > 0) {
                const info = data.docs[0];
                finalData.title = info.title || book.title;
                finalData.authors = info.author_name
                  ? info.author_name.join(", ")
                  : "Unknown";
                finalData.description = info.first_sentence
                  ? typeof info.first_sentence === "string"
                    ? info.first_sentence
                    : info.first_sentence.join(" ")
                  : "No description available.";

                // Prioritize ISBN cover, then fall back to cover_i
                if (book.isbn) {
                  finalData.poster = `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg`;
                } else if (info.cover_i) {
                  finalData.poster = `https://covers.openlibrary.org/b/id/${info.cover_i}-M.jpg`;
                }

                // OpenLibrary does not provide rating, keep N/A
                finalData.found = true;
              }

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

    const recipeCards = recipes.map((recipe) => {
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

      return `
        <div class="recipe-card">
          <div class="recipe-title-bar">
            <h2 class="recipe-title">🍽️ ${recipe.title}</h2>
            <div class="recipe-times">
              ${recipe.prepTime ? `<span class="recipe-time-badge prep-time">💤⏰ Prep: ${recipe.prepTime}</span>` : ""}
              ${displayCookTime ? `<span class="recipe-time-badge cook-time">🕒 Cook: ${displayCookTime}</span>` : ""}
            </div>
          </div>
          <div class="recipe-grid">
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

    return recipeCards.join("");
  }
}
