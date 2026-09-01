import { AbstractView } from "../router";
import { NoteService, Note } from "../services/note";
import { TagCloud } from "../components/tagcloud";
import { showY2KLoading } from "../services/y2k-loading";

export class TagPage extends AbstractView {
  private noteService: NoteService;
  private selectedTags: string[];
  private viewMode: "grid" | "feed";

  constructor(params: any) {
    super(params);
    this.noteService = NoteService.getInstance();
    this.selectedTags = params.tag ? params.tag.split("+") : [];
    this.viewMode = (localStorage.getItem("notesViewMode") as "grid" | "feed") || "grid";
  }

  private createNoteCard(note: Note): HTMLElement {
    const card = document.createElement("div");
    card.classList.add("note-card");

    card.innerHTML = `
            <h2><a href="/${this.noteService.getUrlFromNote(
      note
    )}" class="note-link" data-link>${note.title}</a></h2>
            <div class="note-meta">
                <div class="meta-top">
                    <span class="reading-time"><span class="y2k-hide-emoji">⌛</span> ${note.readingTime}</span>
                    <span class="publish-date"><span class="y2k-hide-emoji">🗓️</span> ${note.publishDate}</span>
                    ${note.githubLink
        ? `<a href="${note.githubLink}" class="github-link" target="_blank" aria-label="View on GitHub"></a>`
        : ""
      }
                    ${note.links && note.links.length > 0
        ? note.links
          .map(
            (link) =>
              `<a href="${link.url}" class="external-link" target="_blank" aria-label="${link.description}">🔗 ${link.description}</a>`
          )
          .join("")
        : ""
      }
                </div>
                <div class="note-tags">
                    ${note.tags
        .map(
          (tag) =>
            `<span class="tag ${this.selectedTags.includes(tag) ? "active" : ""
            }" data-tag="${tag}">${tag}</span>`
        )
        .join("")}
                </div>
            </div>
        `;

    return card;
  }

  async render(): Promise<HTMLElement> {
    const element = document.createElement("div");
    element.classList.add("tag-page");

    const notes = await this.noteService.getNotesByTags(this.selectedTags);

    element.innerHTML = `
            <div class="container">
                <a href="/notes" class="back-to-notes floating ${this.selectedTags.length > 0 ? "visible" : ""
      }" data-link>← Back to all notes</a>
                <div class="notes-header sticky">
                  <h1>Notes tagged with ${this.selectedTags
        .map((tag) => `"${tag}"`)
        .join(" + ")}</h1>
                  <div class="view-toggle">
                    <button class="toggle-btn ${this.viewMode === "grid" ? "active" : ""}" data-view="grid">List</button>
                    <button class="toggle-btn ${this.viewMode === "feed" ? "active" : ""}" data-view="feed">Feed</button>
                  </div>
                </div>
                <div class="tag-cloud-container">
                  <div class="loading">Loading tags...</div>
                </div>
                <div class="notes-content-area">
                  ${this.viewMode === "grid"
        ? '<div class="notes-grid"></div>'
        : '<div class="notes-feed"></div>'
      }
                </div>
                <button class="back-to-top" aria-label="Back to top">↑</button>
            </div>
        `;

    // Add event listeners for toggle
    const toggleBtns = element.querySelectorAll(".toggle-btn");
    toggleBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const newView = btn.getAttribute("data-view") as "grid" | "feed";
        if (newView !== this.viewMode) {
          this.viewMode = newView;
          localStorage.setItem("notesViewMode", this.viewMode);
          if (document.body.dataset.theme === "y2k-cyber") {
            showY2KLoading(5000);
          }
          window.scrollTo(0, 0);
          this.render().then(newElement => {
            element.replaceWith(newElement);
          });
        }
      });
    });

    if (this.viewMode === "grid") {
      const notesGrid = element.querySelector(".notes-grid")!;
      notes.forEach((note) => {
        const noteCard = this.createNoteCard(note);
        const tagElements = noteCard.querySelectorAll(".tag");

        tagElements.forEach((tagElement) => {
          tagElement.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const tag = tagElement.getAttribute("data-tag")!;
            this.toggleTag(tag, element);
          });
        });

        notesGrid.appendChild(noteCard);
      });
    } else {
      const notesFeed = element.querySelector(".notes-feed") as HTMLElement;

      // Prioritize pinned notes
      const pinned = notes.filter(n => n.pinned);
      const others = notes.filter(n => !n.pinned);
      const feedNotes = [...pinned, ...others];

      await this.renderFeed(notesFeed, feedNotes);

      // Attach listeners to tags in the feed
      const tagElements = notesFeed.querySelectorAll(".note-tags .tag");
      tagElements.forEach((tagElement) => {
        tagElement.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const href = (tagElement as HTMLAnchorElement).getAttribute("href");
          if (href) {
            const tag = href.split("/").pop()!;
            this.toggleTag(tag, element);
          }
        });
      });
    }

    // Add scroll event listener for back-to-top button
    const backToTopBtn = element.querySelector(
      ".back-to-top"
    ) as HTMLButtonElement;

    if (backToTopBtn && backToTopBtn.checkVisibility()) {
      window.addEventListener("scroll", () => {
        if (window.scrollY > 300) {
          backToTopBtn.classList.add("visible");
        } else {
          backToTopBtn.classList.remove("visible");
        }
      });

      backToTopBtn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }

    // Setup tag cloud after main content is rendered
    setTimeout(() => this.setupTagCloud(element), 0);

    // Re-render tag cloud when theme changes so colors/fonts update
    const onThemeChange = () => this.setupTagCloud(element);
    window.addEventListener("themechange", onThemeChange);
    (element as any)._themeCloudHandler = onThemeChange;

    return element;
  }

  private async setupTagCloud(element: HTMLElement): Promise<void> {
    try {
      const cloudContainer = element.querySelector(
        ".tag-cloud-container"
      ) as HTMLElement;
      if (cloudContainer && cloudContainer.checkVisibility()) {
        const tagFrequencies = await this.noteService.getTagFrequencies();
        const tagCloud = new TagCloud(
          cloudContainer,
          cloudContainer.clientWidth,
          200,
          (tag: string) => {
            this.toggleTag(tag, element);
          }
        );
        await tagCloud.render(tagFrequencies);
      }
    } catch (error) {
      console.error("Error setting up tag cloud:", error);
      const cloudContainer = element.querySelector(".tag-cloud-container");
      if (cloudContainer) {
        cloudContainer.innerHTML =
          '<div class="error">Failed to load tags</div>';
      }
    }
  }

  private async renderFeed(container: HTMLElement, notes: Note[]): Promise<void> {
    for (const note of notes) {
      const feedItem = document.createElement("div");
      feedItem.classList.add("feed-item");
      if (note.pinned) feedItem.classList.add("pinned");

      const contentHtml = await this.noteService.renderFullNote(note, this.selectedTags);
      feedItem.innerHTML = contentHtml;
      container.appendChild(feedItem);
    }
    // Glossary tooltips anchored to their poem line
    this.noteService.setupGlossaryPopovers(container);
  }

  private toggleTag(tag: string, element: HTMLElement): void {
    if (this.selectedTags.includes(tag)) {
      this.selectedTags = this.selectedTags.filter((t) => t !== tag);
    } else {
      this.selectedTags.push(tag);
    }

    const newUrl =
      this.selectedTags.length > 0
        ? `/tag/${this.selectedTags.join("+")}`
        : "/notes";

    if (this.selectedTags.length === 0) {
      window.location.href = "/notes";
      return;
    }

    history.pushState(null, "", newUrl);
    window.scrollTo(0, 0);
    this.render().then((newElement) => {
      element.replaceWith(newElement);
    });
  }
}
