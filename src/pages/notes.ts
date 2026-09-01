import { AbstractView } from "../router";
import { NoteService, Note } from "../services/note";
import { TagCloud } from "../components/tagcloud";
import { showY2KLoading } from "../services/y2k-loading";

export class NotesPage extends AbstractView {
  private noteService: NoteService;
  private viewMode: "grid" | "feed";

  constructor(params: any) {
    super(params);
    this.noteService = NoteService.getInstance();
    this.viewMode = (localStorage.getItem("notesViewMode") as "grid" | "feed") || "grid";
  }



  private createNoteCard(note: Note): HTMLElement {
    const card = document.createElement("div");
    card.classList.add("note-card");

    card.innerHTML = `
      <h2><a href="/${this.noteService.getUrlFromNote(
      note
    )}" class="note-link" data-link>
        ${note.pinned ? '<span class="pin-icon" style="font-size: 0.9em; margin-right: 0.25rem;"><span class="y2k-hide-emoji">📌</span></span>' : ""}${note.title}
      </a></h2>
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
          ${(note.tags || [])
        .map(
          (tag) => `<a href="/tag/${tag}" class="tag" data-link>${tag}</a>`
        )
        .join("")}
        </div>
      </div>
    `;

    return card;
  }

  async render(): Promise<HTMLElement> {
    const element = document.createElement("div");
    element.classList.add("notes-page");

    await this.noteService.initialize();
    // Warm up note contents + movie/book covers in the background
    this.noteService.prefetchAll();
    const allNotes = this.noteService.getAllNotes(true);
    const gridNotes = allNotes.filter((note) => !note.hidden || note.pinned);
    const collectionPinnedNotes = gridNotes.filter(n => n.pinned && n.hidden);
    const regularGridNotes = gridNotes.filter(n => !(n.pinned && n.hidden));

    // Consolidate sorting so both views see pinned posts at the top
    const sortedNotes = [...regularGridNotes].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0;
    });

    let compactPinnedHtml = "";
    if (collectionPinnedNotes.length > 0) {
      compactPinnedHtml = `
        <div class="compact-pinned-container">
          ${collectionPinnedNotes.map(note => `
            <a href="/${this.noteService.getUrlFromNote(note)}" class="compact-pinned-link" data-link>
              <span class="pin-icon"><span class="y2k-hide-emoji">📌</span></span> ${note.title}
            </a>
          `).join("")}
        </div>
      `;
    }

    element.innerHTML = `
      <div class="container ${this.viewMode === "feed" ? "with-toc" : ""}">
        <div class="notes-header sticky">
          <h1>Notes</h1>
          <div class="view-toggle">
            <button class="toggle-btn ${this.viewMode === "grid" ? "active" : ""}" data-view="grid">List</button>
            <button class="toggle-btn ${this.viewMode === "feed" ? "active" : ""}" data-view="feed">Feed</button>
          </div>
        </div>
        <div class="tag-cloud-container">
          <div class="loading">Loading tags...</div>
        </div>
        <div class="notes-content-area">
          ${compactPinnedHtml}
          ${this.viewMode === "grid"
        ? `
              <div class="notes-grid"></div>
            `
        : `
              <div class="notes-feed"></div>
            `
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
          const app = document.getElementById("app");
          if (app) {
            this.render().then(newElement => {
              app.innerHTML = "";
              app.appendChild(newElement);
            });
          }
        }
      });
    });

    if (this.viewMode === "grid") {
      const notesGrid = element.querySelector(".notes-grid")!;

      sortedNotes.forEach((note) => {
        const card = this.createNoteCard(note);
        if (note.pinned) {
          card.classList.add("pinned-card");
        }
        notesGrid.appendChild(card);
      });
    } else {
      // Render feed view
      const notesFeed = element.querySelector(".notes-feed") as HTMLElement;
      await this.renderFeed(notesFeed, sortedNotes);
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
            window.location.href = `/tag/${tag}`;
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

  private async renderFeed(container: HTMLElement, visibleNotes: Note[]): Promise<void> {
    const feedNotes = visibleNotes;

    let tocHtml = "";
    const tocContainer = document.createElement("div");
    tocContainer.className = "table-of-contents";

    if (feedNotes.length > 0) {
      tocHtml = `
        <h2>All Notes</h2>
        <ul class="toc-list">
          ${feedNotes.map(
            (note) => `
              <li>
                <a href="#feed-note-${note.id}" class="toc-link">${note.title}</a>
              </li>
            `
          ).join("")}
        </ul>
      `;
      tocContainer.innerHTML = tocHtml;
      
      const parentPage = container.closest(".notes-page");
      if (parentPage) {
        parentPage.appendChild(tocContainer);
      }
    }

    for (const note of feedNotes) {
      const feedItem = document.createElement("article");
      feedItem.classList.add("feed-item");
      feedItem.id = `feed-note-${note.id}`;

      const contentHtml = await this.noteService.renderFullNote(note);
      feedItem.innerHTML = contentHtml;
      
      if (note.pinned) {
        feedItem.classList.add("pinned");
      }      container.appendChild(feedItem);
    }

    // Glossary tooltips anchored to their poem line
    this.noteService.setupGlossaryPopovers(container);



    this.setupIntersectionObserver(container, tocContainer);
  }

  private setupIntersectionObserver(container: HTMLElement, sidebar: HTMLElement) {
    const observerOptions = {
      root: null,
      rootMargin: "-20% 0px -80% 0px",
      threshold: 0
    };

    const observer = new IntersectionObserver((entries) => {
      let activeId = "";
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activeId = entry.target.id;
        }
      });

      if (activeId) {
        sidebar.querySelectorAll("a").forEach((link) => {
          link.classList.remove("active");
          if (link.getAttribute("href") === `#${activeId}`) {
            link.classList.add("active");
          }
        });
      }
    }, observerOptions);

    container.querySelectorAll(".feed-item").forEach((item) => observer.observe(item));

    // Smooth scrolling implementation to correctly sync with SPA routing.
    sidebar.querySelectorAll("a").forEach(link => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const targetId = link.getAttribute("href")?.substring(1);
        if (targetId) {
          const targetEl = document.getElementById(targetId);
          if (targetEl) {
            const headerOffset = 100;
            const elementPosition = targetEl.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.scrollY - headerOffset;

            window.scrollTo({
              top: offsetPosition,
              behavior: "smooth"
            });
          }
        }
      });
    });
  }
}
