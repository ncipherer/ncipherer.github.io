import { NoteService, Note } from "../services/note";
import { ClickAudio } from "../services/click-audio";
import { getSearchModal } from "./search";

type TerminalCommand = {
  name: string;
  description: string;
  /** Commands that take an argument: clicking them fills the input and waits. */
  hasArgs?: boolean;
  handler: (args: string) => Promise<string> | string;
};

const STORAGE_KEY = "terminal-output";

let clockTimer: number | null = null;

export class Terminal {
  private outputEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private noteService: NoteService;
  private history: string[] = [];
  private historyIndex: number = -1;
  private commands: TerminalCommand[] = [];
  private modal: HTMLElement | null = null;
  private popoverEl: HTMLElement | null = null;
  private popoverItems: HTMLElement[] = [];
  private popoverIndex: number = 0;
  /** Set while the popover is suggesting an argument for /open or /search. */
  private popoverArgCommand: string | null = null;

  constructor() {
    this.noteService = NoteService.getInstance();
    this.defineCommands();
  }

  private defineCommands(): void {
    this.commands = [
      {
        name: "/list",
        description: "show available commands",
        handler: () => this.cmdList(),
      },
      {
        name: "/notes",
        description: "list all notes",
        handler: () => this.cmdNotes(),
      },
      {
        name: "/tags",
        description: "list all tags",
        handler: () => this.cmdTags(),
      },
      {
        name: "/search",
        description: "deep search all note content — /search <query>",
        hasArgs: true,
        handler: (args) => this.cmdSearch(args),
      },
      {
        name: "/open",
        description: "open a note or tag — /open <name>",
        hasArgs: true,
        handler: (args) => this.cmdOpen(args),
      },
      {
        name: "/clear",
        description: "clear the screen",
        handler: () => {
          this.clearOutput();
          return "";
        },
      },
    ];
  }

  public render(): HTMLElement {
    const el = document.createElement("div");
    el.classList.add("terminal");

    el.innerHTML = `
      <div class="terminal-titlebar">
        <span class="terminal-titlebar-text">encipherer@whispers ~</span>
      </div>
      <div class="terminal-output" id="terminal-output"></div>
      <div class="terminal-input-line">
        <div class="terminal-popover" id="terminal-popover" hidden></div>
        <span class="terminal-prompt">&gt;</span>
        <input
          type="text"
          class="terminal-input"
          id="terminal-input"
          placeholder="/list · /open <note>"
          data-placeholder-full="type /list for commands, or /open &lt;name&gt; to open a note"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </div>
      <div class="terminal-statusbar">
        <span class="terminal-status-left">encipherer@whispers:~$</span>
        <span class="terminal-status-mode" id="terminal-mode">-- NORMAL --</span>
        <span class="terminal-status-right"><span id="terminal-clock">00:00:00</span></span>
      </div>
    `;

    this.outputEl = el.querySelector("#terminal-output");
    this.inputEl = el.querySelector("#terminal-input") as HTMLInputElement;
    this.popoverEl = el.querySelector("#terminal-popover");

    this.setupEventListeners();
    this.setupStatusBar(el);
    this.restoreOutput();
    this.focusOnTerminal(el);

    // Auto-focus on load — desktop only, so the soft keyboard doesn't pop
    // open on phones and tablets
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      setTimeout(() => {
        if (this.inputEl) this.inputEl.focus();
      }, 50);
    }

    return el;
  }

  // ── Session-storage persistence ──────────────────────────────────

  private saveOutput(): void {
    if (!this.outputEl) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, this.outputEl.innerHTML);
    } catch {
      /* quota exceeded — ignore */
    }
  }

  private restoreOutput(): void {
    if (!this.outputEl) return;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      const stalePatterns = [
        "Welcome to", // very first launch messages
        "Available Commands", // old /list heading
        "All Notes (", // old /notes heading
        "Closest matches", // old free-text lookup
        "1 result for", // old inline /search output
      ];
      if (saved && !stalePatterns.some((p) => saved.includes(p))) {
        this.outputEl.innerHTML = saved;
        // Defer: at restore time the terminal isn't attached to the DOM yet,
        // so scrollHeight is 0 — scroll once it's laid out.
        requestAnimationFrame(() => this.scrollToBottom());
        return;
      }
      // Clear stale output from older versions of the terminal
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  // ── Event listeners ──────────────────────────────────────────────

  private setupEventListeners(): void {
    if (!this.inputEl) return;

    // Detect coarse-pointer (touch) devices — skip audio on them to avoid
    // AudioContext overhead that causes visible input lag on mobile.
    const isTouch = window.matchMedia("(pointer: coarse)").matches;

    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (!isTouch && !e.metaKey && !e.ctrlKey && !e.altKey) {
        ClickAudio.playKeystroke();
      }

      if (this.isPopoverOpen()) {
        // Escape always just dismisses the popover
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.closePopover();
          return;
        }
        // While suggestions are listed they take over arrows/enter/tab; an
        // empty-results popover lets Enter and arrows fall through to the input
        if (this.popoverItems.length > 0) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            this.movePopover(1);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            this.movePopover(-1);
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            this.runSelectedPopoverItem();
            return;
          }
        }
      }

      if (e.key === "Enter") {
        e.preventDefault();
        this.handleInput();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.navigateHistory(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        this.navigateHistory(1);
      }
    });

    // Rebuild the command popover as the user types.
    // On touch devices, debounce to avoid hammering the DOM on every
    // composing event from the virtual keyboard.
    if (isTouch) {
      let popoverDebounce: ReturnType<typeof setTimeout> | null = null;
      this.inputEl.addEventListener("input", () => {
        if (popoverDebounce) clearTimeout(popoverDebounce);
        popoverDebounce = setTimeout(() => this.updatePopover(), 80);
      });
    } else {
      this.inputEl.addEventListener("input", () => this.updatePopover());
    }
    // Close the popover when focus leaves the input
    this.inputEl.addEventListener("blur", () => this.closePopover());

    // Event delegation for clickable output items
    if (this.outputEl) {
      this.outputEl.addEventListener("click", (e: MouseEvent) => {
        const target = (e.target as HTMLElement).closest("[data-cmd]") as HTMLElement;
        if (target) {
          e.preventDefault();
          const cmd = target.getAttribute("data-cmd");
          if (cmd && this.inputEl) {
            // An arg-taking command clicked with no args (e.g. "/open" from
            // the /list output) completes into the input and waits — same as
            // clicking it in the popover.
            const trimmed = cmd.trim();
            const bare = this.commands.find(
              (c) => c.hasArgs && trimmed === c.name
            );
            if (bare) {
              this.inputEl.value = `${bare.name} `;
              this.inputEl.setSelectionRange(
                this.inputEl.value.length,
                this.inputEl.value.length
              );
              this.inputEl.focus();
              return;
            }
            this.inputEl.value = cmd;
            this.handleInput();
          }
        }
      });
    }

    // Command popover: pointer navigation (tap on mobile, click on desktop —
    // both run instantly and keep focus in the input)
    if (this.popoverEl) {
      this.popoverEl.addEventListener("pointerdown", (e: PointerEvent) => {
        const item = (e.target as HTMLElement).closest(".terminal-popover-item") as HTMLElement | null;
        if (!item) return;
        // Touch already plays its click via the global touchstart listener;
        // mouse clicks are suppressed by preventDefault, so play it here.
        if (e.pointerType === "mouse") ClickAudio.playClick();
        e.preventDefault(); // keep focus in the input so blur doesn't close first
        this.activatePopoverItem(item);
      });

      this.popoverEl.addEventListener("mouseover", (e: MouseEvent) => {
        const item = (e.target as HTMLElement).closest(".terminal-popover-item") as HTMLElement | null;
        if (!item) return;
        const idx = Number(item.getAttribute("data-index"));
        if (!Number.isNaN(idx)) {
          this.popoverIndex = idx;
          this.highlightPopoverItem();
        }
      });
    }

    // Close modal on Escape
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.modal) {
        this.closeModal();
      }
    });
  }

  private setupStatusBar(el: HTMLElement): void {
    const modeEl = el.querySelector("#terminal-mode") as HTMLElement | null;
    const clockEl = el.querySelector("#terminal-clock") as HTMLElement | null;

    if (this.inputEl) {
      const setMode = (insert: boolean) => {
        if (!modeEl) return;
        modeEl.textContent = insert ? "-- INSERT --" : "-- NORMAL --";
        modeEl.classList.toggle("insert", insert);
      };
      this.inputEl.addEventListener("focus", () => setMode(true));
      this.inputEl.addEventListener("blur", () => setMode(false));
      // Flip to INSERT as soon as the user starts typing
      this.inputEl.addEventListener("input", () => setMode(true));
    }

    if (clockEl) {
      const tick = () => {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        clockEl.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      };
      tick();
      if (clockTimer !== null) window.clearInterval(clockTimer);
      clockTimer = window.setInterval(tick, 1000);
    }
  }

  private navigateHistory(direction: number): void {
    if (!this.inputEl) return;
    if (this.history.length === 0) return;

    this.historyIndex += direction;
    if (this.historyIndex < -1) this.historyIndex = -1;
    if (this.historyIndex >= this.history.length) this.historyIndex = this.history.length - 1;

    if (this.historyIndex === -1) {
      this.inputEl.value = "";
    } else {
      this.inputEl.value = this.history[this.history.length - 1 - this.historyIndex];
    }
  }

  private async handleInput(): Promise<void> {
    if (!this.inputEl) return;
    const raw = this.inputEl.value.trim();
    if (!raw) return;

    if (this.history.length === 0 || this.history[this.history.length - 1] !== raw) {
      this.history.push(raw);
    }
    this.historyIndex = -1;
    this.inputEl.value = "";

    this.appendOutput(this.echoLine(raw));

    const startsWithSlash = raw.startsWith("/");
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (startsWithSlash) {
      const command = this.commands.find((c) => c.name === cmd);
      const args = parts.slice(1).join(" ");
      if (command) {
        const result = await command.handler(args);
        if (result) {
          this.appendOutput(result);
        }
      } else {
        this.appendOutput(
          `<span class="terminal-error">Unknown command: ${this.escapeHtml(cmd)}</span>\nType <span class="terminal-link" data-cmd="/list">/list</span> to see available commands.`
        );
      }
    } else {
      this.appendOutput(
        `<span class="terminal-error">Type ${this.cmdLink("/list")} for commands, or /open &lt;name&gt; to open a specific note or tag.</span>`
      );
    }

    this.scrollToBottom();
    this.saveOutput();
  }

  // ── Command popover ──────────────────────────────────────────────

  private updatePopover(): void {
    if (!this.inputEl || !this.popoverEl) return;
    const value = this.inputEl.value;
    const trimmed = value.trim();

    if (!trimmed) {
      this.closePopover();
      return;
    }

    if (trimmed.startsWith("/")) {
      const spaceIdx = trimmed.indexOf(" ");
      if (spaceIdx !== -1) {
        // Mid-command: for arg-taking commands, suggest notes/tags for the
        // argument being typed (e.g. "/open mani" → "Hacker's Manifesto")
        const cmdName = trimmed.slice(0, spaceIdx);
        const arg = trimmed.slice(spaceIdx + 1).trim();
        // Only /open takes a note/tag argument worth suggesting as you type —
        // /search takes free-text, so suggestions would be misleading there.
        if (cmdName === "/open" && arg) {
          this.popoverArgCommand = cmdName;
          void this.updateLookupPopover(arg);
        } else {
          this.closePopover();
        }
        return;
      }
      this.popoverArgCommand = null;
      this.updateCommandPopover(trimmed.slice(1).toLowerCase());
    } else {
      // Free text is not a thing — every interaction goes through a command
      this.closePopover();
    }
  }

  private updateCommandPopover(query: string): void {
    if (!this.popoverEl) return;
    const matches = this.commands.filter((c) => this.matchesCommand(c, query));

    if (matches.length === 0) {
      this.popoverEl.innerHTML = `<div class="terminal-popover-empty">No matching commands</div>`;
      this.popoverEl.hidden = false;
      this.popoverItems = [];
      this.popoverIndex = 0;
      return;
    }

    this.popoverEl.innerHTML = matches
      .map(
        (c, i) =>
          `<div class="terminal-popover-item" data-index="${i}" data-command="${this.attrEsc(c.name)}">` +
          `<span class="terminal-popover-cmd">${this.escapeHtml(c.name)}</span>` +
          `<span class="terminal-popover-desc">${this.escapeHtml(c.description)}</span>` +
          `</div>`
      )
      .join("");
    this.popoverEl.hidden = false;
    this.popoverItems = Array.from(
      this.popoverEl.querySelectorAll(".terminal-popover-item")
    ) as HTMLElement[];
    this.popoverIndex = 0;
    this.highlightPopoverItem();
  }

  /** Suggest notes and tags while typing the argument of /open or /search. */
  private async updateLookupPopover(q: string): Promise<void> {
    if (!this.popoverEl) return;
    await this.noteService.initialize();

    // If the user kept typing while we loaded, a newer keystroke already
    // owns the popover — bail so a stale query never overwrites it.
    if (!this.inputEl) return;
    const now = this.inputEl.value.trim();
    const argNow = now.startsWith("/") ? now.slice(now.indexOf(" ") + 1).trim() : "";
    if (argNow !== q) return;

    const ql = q.toLowerCase();
    const notes = this.siteNotes();

    const noteHits = notes.filter(
      (n) => n.title.toLowerCase().includes(ql) || n.blogLink.toLowerCase().includes(ql)
    );

    const tagCounts = new Map<string, number>();
    for (const n of notes) {
      for (const t of n.tags) {
        if (!t) continue;
        if (t.toLowerCase().includes(ql)) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }
    }
    const tagHits = Array.from(tagCounts.entries()).sort((a, b) => b[1] - a[1]);

    if (noteHits.length === 0 && tagHits.length === 0) {
      this.popoverEl.innerHTML = `<div class="terminal-popover-empty">No matching notes or tags</div>`;
      this.popoverEl.hidden = false;
      this.popoverItems = [];
      this.popoverIndex = 0;
      return;
    }

    const parts: string[] = [];
    let index = 0;

    if (noteHits.length > 0) {
      parts.push(`<div class="terminal-popover-section">Notes</div>`);
      for (const n of noteHits.slice(0, 6)) {
        parts.push(
          `<div class="terminal-popover-item" data-index="${index++}" data-command="${this.attrEsc(n.title)}">` +
          `<span class="terminal-popover-cmd terminal-popover-note">${this.escapeHtml(n.title)}</span>` +
          `<span class="terminal-popover-desc">${this.escapeHtml(n.readingTime)}</span>` +
          `</div>`
        );
      }
    }

    if (tagHits.length > 0) {
      parts.push(`<div class="terminal-popover-section">Tags</div>`);
      for (const [tag, count] of tagHits.slice(0, 5)) {
        parts.push(
          `<div class="terminal-popover-item" data-index="${index++}" data-command="${this.attrEsc(tag)}">` +
          `<span class="terminal-popover-cmd term-tag">#${this.escapeHtml(tag)}</span>` +
          `<span class="terminal-popover-desc">${count} note${count === 1 ? "" : "s"}</span>` +
          `</div>`
        );
      }
    }

    this.popoverEl.innerHTML = parts.join("");
    this.popoverEl.hidden = false;
    this.popoverItems = Array.from(
      this.popoverEl.querySelectorAll(".terminal-popover-item")
    ) as HTMLElement[];
    this.popoverIndex = 0;
    this.highlightPopoverItem();
  }

  /** Match the typed fragment against a command name (subsequence aware). */
  private matchesCommand(c: TerminalCommand, query: string): boolean {
    if (query.length === 0) return true;
    const name = c.name.slice(1).toLowerCase();
    if (name.startsWith(query)) return true;
    // Subsequence: "/not" matches "/notes" because n-o-t appear in order
    let i = 0;
    for (const ch of name) {
      if (ch === query[i]) i++;
      if (i === query.length) return true;
    }
    return false;
  }

  private movePopover(direction: number): void {
    if (this.popoverItems.length === 0) return;
    this.popoverIndex += direction;
    if (this.popoverIndex < 0) this.popoverIndex = this.popoverItems.length - 1;
    if (this.popoverIndex >= this.popoverItems.length) this.popoverIndex = 0;
    this.highlightPopoverItem();
    const item = this.popoverItems[this.popoverIndex];
    if (item) item.scrollIntoView({ block: "nearest" });
  }

  private highlightPopoverItem(): void {
    this.popoverItems.forEach((item, i) => {
      item.classList.toggle("selected", i === this.popoverIndex);
    });
  }

  private runSelectedPopoverItem(): void {
    const item = this.popoverItems[this.popoverIndex];
    if (item) this.activatePopoverItem(item);
  }

  /**
   * Activate a popover row. Arg-taking commands (/open, /search) get
   * completed into the input — cursor stays in the terminal, waiting for
   * the argument. Everything else runs immediately.
   */
  private activatePopoverItem(item: HTMLElement): void {
    if (!this.inputEl) return;
    const command = item.getAttribute("data-command");
    if (!command) return;

    const cmd = this.commands.find((c) => c.name === command);
    if (cmd && cmd.hasArgs) {
      this.inputEl.value = `${command} `;
      this.inputEl.setSelectionRange(
        this.inputEl.value.length,
        this.inputEl.value.length
      );
      this.closePopover();
      this.inputEl.focus();
      return;
    }

    if (this.popoverArgCommand) {
      // We're completing the argument of /open or /search: build the full
      // command and run it (e.g. "/open Hacker's Manifesto")
      this.inputEl.value = `${this.popoverArgCommand} ${command}`;
      this.closePopover();
      this.handleInput();
      return;
    }

    this.inputEl.value = command;
    this.closePopover();
    this.handleInput();
  }

  private closePopover(): void {
    if (this.popoverEl) {
      this.popoverEl.hidden = true;
      this.popoverEl.innerHTML = "";
    }
    this.popoverItems = [];
    this.popoverIndex = 0;
    this.popoverArgCommand = null;
  }

  private isPopoverOpen(): boolean {
    return !!this.popoverEl && !this.popoverEl.hidden;
  }

  /** Syntax-coloured echo of what the user typed (like a fish/zsh prompt). */
  private echoLine(raw: string): string {
    const esc = this.escapeHtml;
    const parts = raw.split(/\s+/);
    const head = parts[0];
    const rest = parts.slice(1).join(" ");

    if (head.startsWith("/")) {
      const known = this.commands.some((c) => c.name === head.toLowerCase());
      const cls = known ? "terminal-echo-cmd" : "terminal-echo-cmd unknown";
      return `<span class="terminal-echo">&gt; <span class="${cls}">${esc(head)}</span>${rest ? " " + esc(rest) : ""}</span>`;
    }
    return `<span class="terminal-echo">&gt; ${esc(raw)}</span>`;
  }

  /** Focus the input when clicking the input line area (not the output) */
  private focusOnTerminal(el: HTMLElement): void {
    const inputLine = el.querySelector(".terminal-input-line");
    if (inputLine) {
      inputLine.addEventListener("click", () => {
        if (this.inputEl) this.inputEl.focus();
      });
    }
  }

  // ── Note list rendering ──────────────────────────────────────────

  private noteList(heading: string, notes: Note[]): string {
    const lines: string[] = [];
    lines.push(`<span class="terminal-heading">${this.escapeHtml(heading)} (${notes.length})</span>\n`);
    for (const note of notes) {
      // Clicking runs the real command (free text is not accepted anymore)
      lines.push(`  ${this.cmdLink(`/open ${note.title}`, note.title, "term-note")}`);
    }
    return lines.join("\n");
  }

  // ── Command Handlers ─────────────────────────────────────────────

  private cmdList(): string {
    const lines: string[] = [];
    lines.push('<span class="terminal-heading">Commands</span>\n');

    for (const cmd of this.commands) {
      lines.push(
        `  ${this.cmdLink(cmd.name, cmd.name.padEnd(10), "term-cmd")} ${cmd.description}`
      );
    }

    lines.push(
      `\n<span class="terminal-dim">Tip: /open &lt;name&gt; opens a specific note or tag — try it.</span>`
    );
    return lines.join("\n");
  }

  private async cmdNotes(): Promise<string> {
    await this.noteService.initialize();
    const notes = this.siteNotes();
    return this.noteList("Notes", notes);
  }

  private async cmdTags(): Promise<string> {
    await this.noteService.initialize();
    const freq = await this.noteService.getTagFrequencies();

    if (freq.size === 0) {
      return "No tags found.";
    }

    const sorted = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]);
    const lines: string[] = [];
    lines.push(`<span class="terminal-heading">Tags (${sorted.length})</span>\n`);

    for (const [tag, count] of sorted) {
      // Clicking runs the real command (free text is not accepted anymore)
      lines.push(
        `  ${this.cmdLink(`/open ${tag}`, tag.padEnd(18), "term-tag")} ${count}`
      );
    }

    return lines.join("\n");
  }

  private async cmdOpen(args: string): Promise<string> {
    const query = args.trim();
    if (!query) {
      return 'Usage: /open &lt;title or tag&gt;\nExample: /open manifesto';
    }
    if (query.length < 2) {
      return "Too short — type a few letters of the note title or tag.";
    }

    await this.noteService.initialize();
    const notes = this.siteNotes();
    const q = query.toLowerCase();

    // Exact slug or exact title → open directly
    const exactSlug = notes.find((n) => n.blogLink.toLowerCase() === q);
    if (exactSlug) {
      this.openNoteModal(exactSlug.blogLink);
      return "";
    }
    const exactTitle = notes.find((n) => this.stripEmoji(n.title).toLowerCase() === q);
    if (exactTitle) {
      this.openNoteModal(exactTitle.blogLink);
      return "";
    }

    // Substring match on title / slug
    const titleHits = notes.filter((n) => n.title.toLowerCase().includes(q));
    const slugHits = notes.filter((n) => n.blogLink.toLowerCase().includes(q));
    const hits = Array.from(
      new Map([...titleHits, ...slugHits].map((n) => [n.id, n])).values()
    );
    if (hits.length === 1) {
      this.openNoteModal(hits[0].blogLink);
      return "";
    }
    if (hits.length > 1) {
      return this.noteList(`Multiple matches for "${query}"`, hits);
    }

    // Exact tag → list notes with that tag
    const tagHits = notes.filter((n) =>
      n.tags.some((t) => t.toLowerCase() === q)
    );
    if (tagHits.length > 0) {
      return this.noteList(`#${query}`, tagHits);
    }

    return (
      `Nothing found for "${this.escapeHtml(query)}".\n` +
      `Try ${this.cmdLink("/notes")} or ${this.cmdLink(`/search ${query}`)}.`
    );
  }

  /**
   * /search opens the website's full search modal (same deep content search
   * as the magnifier button) with the query already typed in.
   */
  private cmdSearch(query: string): string {
    getSearchModal().open(query.trim());
    return "";
  }

  // ── Modal navigation ─────────────────────────────────────────────

  private async openNoteModal(slug: string): Promise<void> {
    // Create modal overlay
    this.modal = document.createElement("div");
    this.modal.classList.add("terminal-modal");
    this.modal.innerHTML = `
      <div class="terminal-modal-backdrop"></div>
      <div class="terminal-modal-content">
        <button class="terminal-modal-close" aria-label="Close">&times;</button>
        <div class="terminal-modal-body">
          <div class="loading-content">Loading…</div>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
    document.body.style.overflow = "hidden";

    // Close handlers
    const closeModal = () => this.closeModal();
    this.modal.querySelector(".terminal-modal-backdrop")?.addEventListener("click", closeModal);
    this.modal.querySelector(".terminal-modal-close")?.addEventListener("click", closeModal);

    // Load the note page view dynamically
    try {
      const { NotePage } = await import("../pages/note");
      const view = new (NotePage as any)({ dateid: slug });
      const element = await view.render();

      const body = this.modal.querySelector(".terminal-modal-body");
      if (body) {
        body.innerHTML = "";
        body.appendChild(element);
        // Hide the "Back to all notes" link inside the modal
        const backLink = element.querySelector(".back-to-notes");
        if (backLink) (backLink as HTMLElement).style.display = "none";
      }
    } catch {
      const body = this.modal.querySelector(".terminal-modal-body");
      if (body) {
        body.innerHTML = `<div class="terminal-modal-error">Failed to load note: ${this.escapeHtml(slug)}</div>`;
      }
    }
  }

  private closeModal(): void {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
      document.body.style.overflow = "";
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /** Notes the site actually shows: everything visible plus pinned collections. */
  private siteNotes(): Note[] {
    return this.noteService
      .getAllNotes(true)
      .filter((n) => !n.hidden || n.pinned);
  }

  private stripEmoji(s: string): string {
    return s
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, "")
      .trim();
  }

  private appendOutput(html: string): void {
    if (!this.outputEl) return;
    const block = document.createElement("div");
    block.classList.add("terminal-block");
    block.innerHTML = html;
    this.outputEl.appendChild(block);
    this.scrollToBottom();
  }

  private clearOutput(): void {
    if (!this.outputEl) return;
    this.outputEl.innerHTML = "";
    this.saveOutput();
  }

  private scrollToBottom(): void {
    if (this.outputEl) {
      this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }
  }

  private escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  private attrEsc(str: string): string {
    return this.escapeHtml(str).replace(/"/g, "&quot;");
  }

  private cmdLink(command: string, display?: string, cls?: string): string {
    const text = display || command;
    const attr = this.escapeHtml(command).replace(/"/g, "&quot;");
    const classes = cls ? `terminal-link ${cls}` : "terminal-link";
    return `<span class="${classes}" data-cmd="${attr}">${this.escapeHtml(text)}</span>`;
  }
}