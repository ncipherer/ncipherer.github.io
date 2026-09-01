import { NoteService, Note } from "../services/note";

export class SearchModal {
  private overlay!: HTMLDivElement;
  private input!: HTMLInputElement;
  private clearBtn!: HTMLButtonElement;
  private resultsInfo!: HTMLDivElement;
  private resultsList!: HTMLDivElement;
  private isOpen: boolean = false;

  constructor() {
    // DOM will be lazily created on open()
  }

  private createDom() {
    this.overlay = document.createElement("div");
    this.overlay.className = "search-overlay";
    this.overlay.style.display = "none";

    this.overlay.innerHTML = `
      <div class="search-modal">
        <div class="search-modal-header">
          <button class="search-close-btn">Close</button>
        </div>
        <div class="search-input-container">
          <svg class="search-input-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="search-input" placeholder="Search..." autocomplete="off" />
          <button class="search-clear-btn" style="display: none;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div class="search-results-info" style="display: none;"></div>
        <div class="search-results-list"></div>
      </div>
    `;

    document.body.appendChild(this.overlay);

    this.input = this.overlay.querySelector(".search-input") as HTMLInputElement;
    this.clearBtn = this.overlay.querySelector(".search-clear-btn") as HTMLButtonElement;
    this.resultsInfo = this.overlay.querySelector(".search-results-info") as HTMLDivElement;
    this.resultsList = this.overlay.querySelector(".search-results-list") as HTMLDivElement;
  }

  private setupListeners() {
    // Close button
    const closeBtn = this.overlay.querySelector(".search-close-btn");
    closeBtn?.addEventListener("click", () => this.close());

    // Backdrop click
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // Esc key to close
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    });

    // Clear button
    this.clearBtn.addEventListener("click", () => {
      this.input.value = "";
      this.input.focus();
      this.handleSearch();
    });

    // Input changes
    this.input.addEventListener("input", () => this.handleSearch());

    // Click results
    this.resultsList.addEventListener("click", (e) => {
      if (e.target instanceof Element) {
        const link = e.target.closest("[data-link]");
        if (link) {
          this.close();
        }
      }
    });
  }

  public async open(prefill: string = "") {
    if (!this.overlay) {
      this.createDom();
      this.setupListeners();
    }
    this.isOpen = true;
    this.overlay.style.display = "flex";
    this.input.value = prefill;
    this.resultsInfo.style.display = "none";
    this.resultsList.innerHTML = "";
    this.clearBtn.style.display = prefill ? "block" : "none";
    document.body.style.overflow = "hidden";

    // Pre-initialize notes service and warm up contents in the background so
    // the first search can already match full note bodies.
    const noteService = NoteService.getInstance();
    await noteService.initialize();
    noteService.prefetchAll();

    // When opened with a query (e.g. /search from the terminal), wait for the
    // note bodies so the first results already match deep content.
    if (prefill) {
      this.resultsInfo.style.display = "block";
      this.resultsInfo.textContent = `Searching for "${prefill}"…`;
      this.resultsList.innerHTML = "";
      await noteService.prefetchAllContent();
      // The user may have started typing while bodies loaded — don't clobber
      // their keystrokes with a stale search; their input event handles it.
      if (this.input.value === prefill) {
        this.handleSearch();
      }
    }

    setTimeout(() => {
      this.input.focus();
    }, 50);
  }

  public close() {
    this.isOpen = false;
    this.overlay.style.display = "none";
    document.body.style.overflow = "";
  }

  private handleSearch() {
    const query = this.input.value.trim().toLowerCase();
    
    if (query.length > 0) {
      this.clearBtn.style.display = "block";
    } else {
      this.clearBtn.style.display = "none";
      this.resultsInfo.style.display = "none";
      this.resultsList.innerHTML = "";
      return;
    }

    const noteService = NoteService.getInstance();
    // Include hidden notes so pinned posts (which are hidden: true) also appear
    const allNotes = noteService.getAllNotes(true);

    const matchNote = (note: Note) => {
      const titleMatch = note.title.toLowerCase().includes(query);
      const tagsMatch = note.tags?.some(tag => tag.toLowerCase().includes(query)) || false;
      const contentMatch = note.content ? note.content.toLowerCase().includes(query) : false;
      return titleMatch || tagsMatch || contentMatch;
    };

    // Pinned posts (hidden: true, pinned: true) — always shown
    const pinnedResults = allNotes.filter(note => note.pinned && matchNote(note));
    // Other visible notes (not hidden, not pinned)
    const otherResults = allNotes.filter(note => !note.pinned && !note.hidden && matchNote(note));

    this.renderResults(pinnedResults, otherResults, query);
  }

  private renderResults(pinnedResults: Note[], otherResults: Note[], query: string) {
    const total = pinnedResults.length + otherResults.length;
    this.resultsInfo.style.display = "block";
    this.resultsInfo.textContent = `${total} result${total === 1 ? "" : "s"} for "${query}"`;

    this.resultsList.innerHTML = "";

    const noteService = NoteService.getInstance();

    const buildItem = (note: Note): HTMLElement => {
      const resultItem = document.createElement("div");
      resultItem.className = "search-result-item";

      const titleHtml = highlightText(note.title, query);

      const cleanContent = stripMarkdownAndHtml(note.content || "");
      const queryIndex = cleanContent.toLowerCase().indexOf(query);

      let snippetText = "";
      if (queryIndex !== -1) {
        const start = Math.max(0, queryIndex - 60);
        const end = Math.min(cleanContent.length, queryIndex + 140);
        snippetText = cleanContent.substring(start, end);
        if (start > 0) snippetText = "..." + snippetText;
        if (end < cleanContent.length) snippetText = snippetText + "...";
      } else {
        snippetText = cleanContent.substring(0, 180);
        if (cleanContent.length > 180) snippetText += "...";
      }

      const snippetHtml = highlightText(snippetText, query);
      const url = `/${noteService.getUrlFromNote(note)}`;

      resultItem.innerHTML = `
        <h3>
          <a href="${url}" class="search-result-title-link" data-link>${titleHtml}</a>
        </h3>
        <p class="search-result-snippet">${snippetHtml}</p>
      `;
      return resultItem;
    };

    if (pinnedResults.length > 0) {
      const sectionEl = document.createElement("div");
      sectionEl.className = "search-section";
      sectionEl.innerHTML = `<h4 class="search-section-title">📌 Pinned Posts</h4>`;
      pinnedResults.forEach(note => sectionEl.appendChild(buildItem(note)));
      this.resultsList.appendChild(sectionEl);
    }

    if (otherResults.length > 0) {
      const sectionEl = document.createElement("div");
      sectionEl.className = "search-section";
      sectionEl.innerHTML = `<h4 class="search-section-title">📝 Notes</h4>`;
      otherResults.forEach(note => sectionEl.appendChild(buildItem(note)));
      this.resultsList.appendChild(sectionEl);
    }

    if (total === 0) {
      this.resultsList.innerHTML = `<p class="search-no-results">No results found for "${query}"</p>`;
    }
  }
}

// Shared instance so both the navbar shortcut (Ctrl+K / "/") and the
// terminal's /search command open the same modal.
let searchModalInstance: SearchModal | null = null;

export function getSearchModal(): SearchModal {
  if (!searchModalInstance) searchModalInstance = new SearchModal();
  return searchModalInstance;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMarkdownAndHtml(text: string): string {
  // Remove HTML tags
  let clean = text.replace(/<\/?[^>]+(>|$)/g, "");
  // Remove markdown headers
  clean = clean.replace(/^#+\s+/gm, "");
  // Remove blockquotes (>)
  clean = clean.replace(/^\s*>\s*/gm, "");
  clean = clean.replace(/>/g, "");
  // Remove bold/italic formatting
  clean = clean.replace(/[*_`]/g, "");
  // Preserve glossary text: [text](glossary:definition) -> text (definition)
  clean = clean.replace(/\[([^\]]+)\]\(glossary:([^)]+)\)/g, "$1 ($2)");
  // Remove links: [text](url) -> text
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Remove images: ![alt](url) -> alt or empty
  clean = clean.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  // Replace HTML entities
  clean = clean.replace(/&nbsp;/gi, " ");
  clean = clean.replace(/&amp;/gi, "&");
  clean = clean.replace(/&lt;/gi, "<");
  clean = clean.replace(/&gt;/gi, ">");
  // Normalize whitespace (reduce multiple spaces/newlines to one)
  clean = clean.replace(/\s+/g, " ");
  return clean.trim();
}

function highlightText(text: string, query: string): string {
  if (!query) return text;
  const escaped = escapeRegExp(query);
  let regex: RegExp;
  if (/^[a-zA-Z0-9]+$/.test(query)) {
    regex = new RegExp(`(\\b\\w*${escaped}\\w*\\b)`, "gi");
  } else {
    regex = new RegExp(`(${escaped})`, "gi");
  }
  
  // Basic HTML escape to prevent XSS while we inject <span class="search-highlight">
  const div = document.createElement("div");
  div.textContent = text;
  const escapedText = div.innerHTML;
  
  return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}
