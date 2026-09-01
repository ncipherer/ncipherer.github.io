import { AbstractView } from "../router";
import { NoteService } from "../services/note";
import { MusicPlayerService, Track } from "../services/player";
import { Carousel } from "../components/carousel";
import { PhotoService } from "../services/photo";
import { ClickAudio } from "../services/click-audio";
import { bookDetails, ensureCatalog, movieDetails } from "../services/catalog";
import {
  BioscopeController,
  BioscopeFilm,
  mountBioscopes,
  renderBioscope,
} from "../components/bioscope";
import {
  CoverImageCacheEntry,
  getCachedCoverImage,
  persistCoverImage,
} from "../services/cache";
import { FocusTrap, attachMenuKeys } from "../services/focus-trap";

// Covers already fetched for the shelf row, keyed by their URL. The review
// modal reuses these instead of requesting the same image a second time.
const loadedCovers = new Map<string, HTMLImageElement>();

// The song list is re-rendered on every visit, so the ⋯ menu's document-level
// listeners are torn down before new ones are attached.
let songMenuCleanup: (() => void) | null = null;

export class NotePage extends AbstractView {
  private noteService: NoteService;
  private scrollVal: number;

  constructor(params: any) {
    super(params);
    this.noteService = NoteService.getInstance();
    this.scrollVal = 500;
  }

  async render(): Promise<HTMLElement> {
    const element = document.createElement("div");
    element.classList.add("note-page");

    element.innerHTML = `
            <div class="container with-toc">
                <a href="/notes" class="back-to-notes floating visible" data-link>← Back to all notes</a>
                <div id="note-content"></div>
            </div>
        `;

    try {
      await this.noteService.initialize();
      const note = this.noteService.getNoteByBlogLink(this.params.dateid);
      document.title = note
        ? `${note.title} — encipherer's whispers`
        : "Note not found — encipherer's whispers";

      if (!note) {
        const noteContent = element.querySelector("#note-content");
        if (noteContent) {
          noteContent.innerHTML = `
                        <h1>Note not found</h1>
                        <p>The requested note could not be found. Please check the URL and try again.</p>
                    `;
        }
        return element;
      }

      const noteContent = element.querySelector("#note-content");
      if (noteContent) {
        noteContent.innerHTML = `
                    <div class="note-header">
                        <div class="note-header-top">
                            <h1>${note.title}</h1>
                        </div>
                        <button class="copy-link-btn" onclick="copyNoteLink('${note.id
          }')">Copy Link</button>
                            <div class="note-meta">
                            <span class="reading-time"><span class="y2k-hide-emoji">⌛</span> ${note.readingTime
          }</span>
                            <span class="publish-date"><span class="y2k-hide-emoji">🗓️</span> ${note.publishDate
          }</span>
                            <div class="note-tags">
                                ${note.tags
            .map(
              (tag) =>
                `<a href="/tag/${tag}" class="tag" data-link>${tag}</a>`,
            )
            .join("")}
                            </div>
                            ${note.githubLink
            ? `<a href="${note.githubLink}" class="github-link" target="_blank" aria-label="View on GitHub"></a>`
            : ""
          }
                            ${note.links && note.links.length > 0
            ? note.links
              .map(
                (link) =>
                  `<a href="${link.url}" class="external-link" target="_blank" aria-label="${link.description}">🔗 ${link.description}</a>`,
              )
              .join("")
            : ""
          }
                        </div>
                    </div>
                    <div class="note-content">
                        ${(() => {
            const renderContent = async () => {
              const content = await this.noteService.fetchNoteContent(note);
              if (note.blogLink === "screens") return this.renderMovies(content);
              if (note.blogLink === "songs") return this.renderSongs(content);
              if (note.blogLink === "paper-shelf") return this.renderPaperShelf(content);
              if (note.blogLink === "books") return this.renderBooks(content);
              if (note.blogLink === "recipes") return this.noteService.renderRecipes(content);
              if (note.blogLink === "purpose") return this.noteService.renderBucketList(content);
              if (note.blogLink === "photos") return this.renderPhotosCarousel(content);
              return this.noteService.parseMarkdown(content);
            };
            renderContent().then(html => {
              const nc = element.querySelector(".note-content") as HTMLElement;
              if (nc) {
                nc.innerHTML = html;
                // Mount carousel if photos note
                if (note.blogLink === "photos") {
                  this.mountPhotosCarousel(nc);
                }                this.setupTableOfContents(element);
                this.setupRecipeInteractivity(element);

                if (note.blogLink === "purpose") this.setupBucketListModals();
                if (note.blogLink === "books") this.setupBookshelfInteractivity();
                // Glossary tooltips anchored to their poem line (content is
                // async, so wire them up only once the terms exist)
                this.noteService.setupGlossaryPopovers(element);
              }
            });
            return "<div class=\"loading-content\">Loading…</div>";
          })()
          }        </div>
                    <div class="note-navigation">
                        ${(() => {
            const adjacentNotes =
              this.noteService.getAdjacentNotes(note);
            return `
                            ${adjacentNotes.previous
                ? `
                              <a href="/${this.noteService.getUrlFromNote(
                  adjacentNotes.previous,
                )}" class="nav-link prev" data-link>
                                <span class="nav-label">← Previous</span>
                                <span class="nav-title">${adjacentNotes.previous.title
                }</span>
                              </a>
                            `
                : ""
              }
                            ${adjacentNotes.next
                ? `
                              <a href="/${this.noteService.getUrlFromNote(
                  adjacentNotes.next,
                )}" class="nav-link next" data-link>
                                <span class="nav-label">Next →</span>
                                <span class="nav-title">${adjacentNotes.next.title
                }</span>
                              </a>
                            `
                : ""
              }
                          `;
          })()} 
                    </div>
                    <!-- begin wwww.htmlcommentbox.com -->
                    <div id="HCB_comment_box" style="margin-top: 3rem;"></div>
                    <link rel="stylesheet" type="text/css" href="https://www.htmlcommentbox.com/static/skins/bootstrap/twitter-bootstrap.css?v=0" />
                    <!-- end www.htmlcommentbox.com -->
                    <button class="back-to-top" aria-label="Back to top">↑</button>
                `;

        // Setup table of contents after content is rendered
        this.setupTableOfContents(element);

        // Setup scroll event listeners
        this.setupScrollListeners(element);

        // Setup recipe interactivity
        this.setupRecipeInteractivity(element);

        // Initialize HTML Comment Box with proper error handling
        const script = document.createElement("script");
        script.type = "text/javascript";
        script.id = "hcb";
        const location = window.location.toString().replace(/'/g, "%27");
        script.src = `https://www.htmlcommentbox.com/jread?page=${encodeURIComponent(
          location,
        ).replace(
          "+",
          "%2B",
        )}&mod=%241%24wq1rdBcg%24KJMmEL71byVY1j2LJQUns0&opts=17310&num=10&ts=${Date.now()}`;

        // Add load and error event listeners
        script.onload = () => {
          const commentBox = document.querySelector("#HCB_comment_box");
          if (commentBox) {
            // Re-run TOC setup after comment box is initialized
            this.setupTableOfContents(element);
          }
        };

        script.onerror = (error) => {
          console.error("[HCB Debug] Error loading comment box script:", error);
        };

        document.head.appendChild(script);

        // Add the copyNoteLink function to window object
        (window as any).copyNoteLink = (id: string) => {
          const note = this.noteService.getNoteById(id);
          if (note) {
            const dateId = this.noteService.getUrlFromNote(note);
            const url = window.location.origin + "/" + dateId;
            navigator.clipboard
              .writeText(url)
              .then(() => {
                const btn = document.querySelector(
                  ".copy-link-btn",
                ) as HTMLButtonElement;
                if (btn) {
                  const originalText = btn.textContent || "Copy Link";
                  btn.textContent = "Copied!";
                  setTimeout(() => {
                    btn.textContent = originalText;
                  }, 2000);
                }
              })
              .catch((err) => console.error("Failed to copy:", err));
          }
        };
      }

      return element;
    } catch (error) {
      console.error("Error loading note:", error);
      const noteContent = element.querySelector("#note-content");
      if (noteContent) {
        noteContent.innerHTML = `
                    <h1>Error Loading Note</h1>
                    <p>There was an error loading the note content. Please try again later.</p>
                `;
      }
      return element;
    }
  }
  private extractHeadings(): { level: number; text: string; id: string }[] {
    const headings: { level: number; text: string; id: string }[] = [];

    // First, get the note title from note-header-top
    const noteTitle = document.querySelector(".note-header-top h1");
    if (noteTitle) {
      const titleText = noteTitle.textContent || "";
      const titleId = titleText.toLowerCase().replace(/[^\w]+/g, "-");
      noteTitle.id = titleId;
      headings.push({ level: 1, text: titleText, id: titleId });
    }

    const content = document.querySelector(".note-content");
    if (!content) {
      return headings;
    }

    const headingElements = content.querySelectorAll("h1, h2, h3, h4, h5, h6");
    headingElements.forEach((heading) => {
      // Skip headings inside movie, recipe and paper cards (playlist titles
      // in song section headers ARE the TOC entries the user asked for, so
      // they are deliberately not skipped). The bioscope's wall carries the
      // film currently threaded in, which is never a section of the note.
      if (
        heading.closest(".movie-card") ||
        heading.closest(".recipe-card") ||
        heading.closest(".paper-card") ||
        heading.closest(".bioscope-rig")
      ) {
        return;
      }
      // Skip headings inside review modals — their titles duplicate the
      // movie-card titles already in the TOC.
      if (heading.closest(".movie-review-modal")) {
        return;
      }
      const level = parseInt(heading.tagName[1]);
      const tempEl = heading.cloneNode(true) as HTMLElement;
      const existingAnchor = tempEl.querySelector(".heading-anchor");
      if (existingAnchor) {
        existingAnchor.remove();
      }
      const text = (tempEl.textContent || "").trim();
      const id = text.toLowerCase().replace(/[^\w]+/g, "-");
      heading.id = id;
      headings.push({ level, text, id });
      // Add a hoverable anchor link to allow copying the deep link — but not
      // on a playlist title: those own a ⋯ menu with "Copy link" in it, and a
      // 🔗 that appears on hover is one control too many for one job.
      if (
        !heading.querySelector(".heading-anchor") &&
        !heading.closest(".bucket-card") &&
        !heading.classList.contains("section-title")
      ) {
        const anchor = document.createElement("a");
        anchor.className = "heading-anchor";
        anchor.href = `#${id}`;
        anchor.innerHTML = "🔗";
        anchor.title = "Copy link to this section";
        anchor.addEventListener("click", (e) => {
          e.preventDefault();
          const url = `${window.location.origin}${window.location.pathname}#${id}`;
          navigator.clipboard.writeText(url).then(() => {
            const originalText = anchor.innerHTML;
            anchor.innerHTML = "✓";
            anchor.classList.add("copied");
            setTimeout(() => {
              anchor.innerHTML = originalText;
              anchor.classList.remove("copied");
            }, 2000);
          }).catch((err) => {
            console.error("Failed to copy link:", err);
          });
          history.pushState(null, "", `#${id}`);
          heading.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        heading.appendChild(anchor);
      }
    });

    // Add Comments section if HTMLCommentBox exists
    const commentBox = document.querySelector("#HCB_comment_box");
    if (commentBox) {
      headings.push({
        level: 1,
        text: "Comments",
        id: "HCB_comment_box",
      });
    }

    return headings;
  }

  private setupBucketListModals(): void {
    // Move all bucket modals to body for proper stacking
    document.querySelectorAll(".bucket-modal").forEach((modal) => {
      document.body.appendChild(modal);
    });

    document.querySelectorAll<HTMLElement>(".bucket-card").forEach((card) => {
      card.addEventListener("click", () => {
        const bucketId = (card as HTMLElement).dataset.bucketId;
        if (bucketId) {
          const modal = document.getElementById(bucketId);
          if (modal) {
            modal.classList.add("active");
            document.body.style.overflow = "hidden";
            this.focusTraps.get(modal)?.activate(
              modal.querySelector<HTMLElement>(".bucket-modal-close"),
            );
          }
        }
      });
    });

    document.querySelectorAll<HTMLElement>(".bucket-modal").forEach((modal) => {
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      this.focusTraps.set(modal, new FocusTrap(modal));
      const closeModal = () => {
        modal.classList.remove("active");
        document.body.style.overflow = "";
        this.focusTraps.get(modal)?.deactivate();
      };
      modal.querySelector(".bucket-modal-backdrop")?.addEventListener("click", closeModal);
      modal.querySelector(".bucket-modal-close")?.addEventListener("click", closeModal);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("active")) closeModal();
      });
    });
  }

  /** Traps for the bucket-list cards, keyed by the dialog element. */
  private focusTraps = new Map<HTMLElement, FocusTrap>();

  private setupRecipeInteractivity(element: HTMLElement): void {
    const ingredients = element.querySelectorAll(".recipe-ingredients li");
    ingredients.forEach((ing) => {
      ing.addEventListener("click", () => {
        ing.classList.toggle("checked");
      });
    });

    const steps = element.querySelectorAll(".recipe-step");
    steps.forEach((step) => {
      const stepNum = step.querySelector(".step-num");
      if (stepNum) {
        stepNum.addEventListener("click", (e) => {
          e.stopPropagation();
          step.classList.toggle("checked");
        });
      }
    });
  }

  private createTableOfContents(
    headings: { level: number; text: string; id: string }[],
  ): HTMLElement {
    const toc = document.createElement("div");
    toc.classList.add("table-of-contents");
    toc.innerHTML = "<h2>On This Page</h2>";

    const tocList = document.createElement("ul");
    tocList.classList.add("toc-list");

    let currentLevel = 1;
    let currentList = tocList;
    let listStack = [tocList];

    headings.forEach(({ level, text, id }) => {
      while (level > currentLevel) {
        const newList = document.createElement("ul");
        currentList.lastElementChild?.appendChild(newList);
        listStack.push(newList);
        currentList = newList;
        currentLevel++;
      }

      while (level < currentLevel) {
        listStack.pop();
        currentList = listStack[listStack.length - 1];
        currentLevel--;
      }

      const li = document.createElement("li");
      li.innerHTML = `<a href="#${id}" class="toc-link">${text}</a>`;
      currentList.appendChild(li);
    });

    toc.appendChild(tocList);
    return toc;
  }

  private setupTableOfContents(element: HTMLElement): void {
    // Wait for a short time to ensure content is rendered
    setTimeout(() => {
      const headings = this.extractHeadings();
      if (headings.length === 0) {
        return;
      }

      const toc = this.createTableOfContents(headings);
      const container = element.querySelector(".container.with-toc");
      if (!container) {
        return;
      }

      // Remove any existing TOC first to prevent duplicates
      const existingTocs = container.querySelectorAll(".table-of-contents");
      existingTocs.forEach((t) => t.remove());

      // Insert TOC after the back-to-notes links but before note-content
      const noteContent = container.querySelector("#note-content");
      if (noteContent) {
        container.insertBefore(toc, noteContent);
      } else {
      }

      // Add click event listeners to TOC links (except for note title)
      toc.querySelectorAll(".toc-link").forEach((link) => {
        const href = (link as HTMLAnchorElement).getAttribute("href")?.slice(1);
        if (href) {
          const target = document.getElementById(href);
          // Skip note title (H1)
          if (target) {
            link.addEventListener("click", (e) => {
              e.preventDefault();
              history.pushState(null, "", `#${href}`);
              target.scrollIntoView({ behavior: "smooth", block: "start" });
            });
          }
        }
      });

      // Track which heading is currently active using a robust scroll-based approach.
      // We maintain a map of each heading's position relative to the viewport and
      // pick the last heading that has passed the top of the visible area.
      const headingEls: HTMLElement[] = [];
      headings.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (el && (el.tagName.match(/^H[1-6]$/) || id === "HCB_comment_box")) {
          headingEls.push(el);
        }
      });

      let activeLinkHref = "";

      const updateActiveLink = () => {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) return;

        const scrollY = window.scrollY;
        const offset = 120; // px below the top to treat as "in view"

        // Find the last heading whose top is above the offset line
        let activeId = headingEls.length > 0 ? headingEls[0].id : "";
        for (const el of headingEls) {
          const top = el.getBoundingClientRect().top + scrollY;
          if (top - scrollY <= offset) {
            activeId = el.id;
          }
        }

        if (activeId !== activeLinkHref) {
          activeLinkHref = activeId;
          toc.querySelectorAll(".toc-link").forEach((link) => {
            const href = (link as HTMLAnchorElement).getAttribute("href")?.slice(1);
            if (href === activeId) {
              link.classList.add("active");
              // Scroll the TOC so the active link is visible
              const linkRect = link.getBoundingClientRect();
              const tocRect = toc.getBoundingClientRect();
              if (linkRect.bottom > tocRect.bottom) {
                toc.scrollTo({ top: toc.scrollTop + (linkRect.bottom - tocRect.bottom) + 20, behavior: "smooth" });
              } else if (linkRect.top < tocRect.top) {
                toc.scrollTo({ top: toc.scrollTop - (tocRect.top - linkRect.top) - 20, behavior: "smooth" });
              }
            } else {
              link.classList.remove("active");
            }
          });
        }
      };

      window.addEventListener("scroll", updateActiveLink, { passive: true });
      // Run once on setup to highlight the correct item on initial load
      updateActiveLink();

      // If there's a hash in the URL, scroll to the corresponding heading after layout renders
      const hash = window.location.hash;
      if (hash) {
        const id = decodeURIComponent(hash.slice(1));
        const target = document.getElementById(id);
        if (target) {
          setTimeout(() => {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 100);
        }
      }
    }, 100);
  }

  private setupScrollListeners(element: HTMLElement): void {
    const backToTopBtn = element.querySelector(
      ".back-to-top",
    ) as HTMLButtonElement;
    const floatingBackLink = element.querySelector(
      ".back-to-notes.floating",
    ) as HTMLAnchorElement;
    const originalBackLink = element.querySelector(
      ".back-to-notes:not(.floating)",
    ) as HTMLAnchorElement;

    if (backToTopBtn && backToTopBtn.checkVisibility()) {
      window.addEventListener("scroll", () => {
        if (window.scrollY > this.scrollVal) {
          backToTopBtn.classList.add("visible");
          backToTopBtn.style.opacity = "1";
          backToTopBtn.style.visibility = "visible";
        } else {
          backToTopBtn.classList.remove("visible");
          backToTopBtn.style.opacity = "0";
          backToTopBtn.style.visibility = "hidden";
        }
      });

      backToTopBtn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }

    if (
      floatingBackLink &&
      originalBackLink &&
      floatingBackLink.checkVisibility()
    ) {
      const originalBackLinkRect = originalBackLink.getBoundingClientRect();
      const originalTop = originalBackLinkRect.top + this.scrollVal;

      window.addEventListener("scroll", () => {
        if (window.scrollY > originalTop) {
          floatingBackLink.classList.add("visible");
        } else {
          floatingBackLink.classList.remove("visible");
        }
      });
    }
  }

  private renderPhotosCarousel(content: string): string {
    const markdownHtml = this.noteService.parseMarkdown(content);
    return `${markdownHtml}<div id="photos-carousel-mount"></div>`;
  }

  private mountPhotosCarousel(container: HTMLElement): void {
    const mount = container.querySelector("#photos-carousel-mount");
    if (!mount) return;
    const photoService = PhotoService.getInstance();
    const photos = photoService.getPhotos();
    const carousel = new Carousel(photos);
    mount.appendChild(carousel.render());
  }

  private async renderMovies(content: string): Promise<string> {
    await ensureCatalog();
    const lines = content.split("\n");
    const sections: any[] = [];
    let currentSection: any = null;
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

    // --- Instant render: one bioscope (and its rack) per section ---
    const renderedSections = sections.map((section) => {
      const slug = section.title.toLowerCase().replace(/\s+/g, "-");
      const modalsHtml: string[] = [];

      // Each film becomes a frame of the rack. Artwork and credits come from
      // the catalog generated at build time by scripts/build-catalog.js — the
      // browser never calls OMDB/TMDB, and no API key ever reaches the bundle.
      const films: BioscopeFilm[] = section.movies.map(
        (movie: any, index: number) => {
          const cd = movieDetails(movie);
          const movieId = `movie-${slug}-${index}`;
          const hasReview = !!movie.review && movie.review.trim() !== "";
          const displayTitle = cd && cd.title
            ? `${cd.title}${cd.year ? ` (${cd.year})` : ""}`
            : `${movie.title}${movie.year ? ` (${movie.year})` : ""}`;
          const displayDir = cd && cd.director ? cd.director : "";
          const displayPoster = cd ? cd.poster : "";

          // The review itself is the modal behind the projection.
          if (hasReview) {
            modalsHtml.push(`
          <div class="movie-review-modal" id="${movieId}">
            <div class="modal-backdrop"></div>
            <div class="modal-content">
              <button class="modal-close">&times;</button>
              <div class="modal-body">
                <img src="${displayPoster}" alt="${movie.title} poster" class="modal-poster" id="modal-poster-${movieId}" loading="lazy" decoding="async" onerror="this.classList.add('img-fallback');this.removeAttribute('src')">
                <div class="modal-info">
                  <h2 id="modal-title-${movieId}">${displayTitle}</h2>
                  <p class="modal-meta"><strong>Director:</strong> <span id="modal-dir-${movieId}">${displayDir || "—"}</span></p>
                  <div class="modal-review">
                    <h3>Notes</h3>
                    <p>${movie.review.replace(/\n/g, "<br>")}</p>
                  </div>
                </div>
              </div>
            </div>
            <button class="modal-nav-btn modal-nav-prev" aria-label="Previous review">&#8249;</button>
            <button class="modal-nav-btn modal-nav-next" aria-label="Next review">&#8250;</button>
          </div>
        `);
          }

          return {
            id: movieId,
            title: displayTitle,
            director: displayDir,
            poster: displayPoster,
            hasReview,
            seen: !!movie.isSeen && !movie.inTheatre,
            inTheatre: !!movie.inTheatre,
          };
        },
      );

      return `${renderBioscope({ slug, title: section.title, films })}${modalsHtml.join("")}`;
    });

    // Add event listener setup for modals
    setTimeout(() => {
      // Move all modals to body for proper positioning
      document.querySelectorAll(".movie-review-modal").forEach((modal) => {
        document.body.appendChild(modal);
      });

      // Ordered list of review modals (document order = page order), used for
      // skimming between reviews with the prev/next controls.
      const reviewModals = Array.from(
        document.querySelectorAll<HTMLElement>(".movie-review-modal"),
      );

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // The bioscopes are mounted a little further down, but the review controls
      // need them: opening, skimming and closing a review all move the same
      // wall. Holding the controller here keeps that order free.
      let bioscope: BioscopeController | null = null;
      /** One focus trap per review card, made on first use. */
      const reviewTraps = new Map<HTMLElement, FocusTrap>();
      const trapFor = (modal: HTMLElement): FocusTrap => {
        let trap = reviewTraps.get(modal);
        if (!trap) {
          trap = new FocusTrap(modal);
          reviewTraps.set(modal, trap);
        }
        return trap;
      };
      /**
       * @param follow move the wall to this review. True when skimming
       * from another review.
       */
      const openReview = (modal: HTMLElement, follow = false) => {
        // Always open at the top of the review — the card keeps the position it
        // was left at on the previous film otherwise.
        const content = modal.querySelector<HTMLElement>(".modal-body");
        if (content) content.scrollTop = 0;
        modal.classList.add("active");
        document.body.style.overflow = "hidden";
        // The keyboard comes with the reader: focus moves into the card and
        // stays there until it closes, then goes back where it came from.
        trapFor(modal).activate(modal.querySelector<HTMLElement>(".modal-close"));
        // Ensure the bioscope aligns with the open review and any in-flight
        // wind from a previous interaction is stopped.
        bioscope?.focus(modal.id, { animate: follow, scroll: true });
      };
      const closeReview = (modal: HTMLElement, returnToRack = false) => {
        modal.classList.remove("active");
        document.body.style.overflow = "";
        trapFor(modal).deactivate();
        if (!returnToRack) return;

        // Keep focus on the review that was open/skimmed to; do not rewind back.
        bioscope?.focus(modal.id, { animate: false, scroll: true });
        const rack = bioscope?.rackFor(modal.id);
        if (!rack) return;
        const rect = rack.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              rack.scrollIntoView({
                block: "center",
                behavior: reducedMotion ? "auto" : "smooth",
              }),
            ),
          );
        }
      };
      const activeReview = () =>
        reviewModals.find((m) => m.classList.contains("active")) || null;

      // Move to the previous/next review in the list (buttons, arrow keys, swipe);
      // returns true when a review was actually switched
      const navigateReview = (dir: 1 | -1): boolean => {
        const active = activeReview();
        if (!active) return false;
        const idx = reviewModals.indexOf(active);
        const next = reviewModals[idx + dir];
        if (!next) return false;
        closeReview(active);
        openReview(next, true);
        return true;
      };

      // The bioscope itself: the arrows at the wall turn the reel, a frame
      // loads what it holds, and the wall follows the open review along.
      bioscope = mountBioscopes((movieId) => {
        const modal = document.getElementById(movieId);
        if (modal) openReview(modal);
      });

      reviewModals.forEach((modal, index) => {
        // A dialog should say it is one, and say what it is called.
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        const heading = modal.querySelector(".modal-info h2")?.textContent?.trim();
        if (heading) modal.setAttribute("aria-label", `Notes on ${heading}`);

        // Dismissing a review puts the reader back on the wall they were
        // reading from; the arrows and Escape keep the rack in step too.
        const closeModal = () => closeReview(modal, true);

        modal
          .querySelector(".modal-backdrop")
          ?.addEventListener("click", closeModal);
        modal
          .querySelector(".modal-close")
          ?.addEventListener("click", closeModal);

        // Prev/next controls (disabled at the ends of the list)
        const prevBtn = modal.querySelector<HTMLButtonElement>(".modal-nav-prev");
        const nextBtn = modal.querySelector<HTMLButtonElement>(".modal-nav-next");
        if (index === 0 && prevBtn) prevBtn.disabled = true;
        if (index === reviewModals.length - 1 && nextBtn) nextBtn.disabled = true;
        prevBtn?.addEventListener("click", () => {
          navigateReview(-1);
        });
        nextBtn?.addEventListener("click", () => {
          navigateReview(1);
        });

        // Swipe left/right to move between reviews on touch devices
        let touchStartX = 0;
        let touchStartY = 0;
        modal.addEventListener(
          "touchstart",
          (e) => {
            const t = e.changedTouches[0];
            touchStartX = t.clientX;
            touchStartY = t.clientY;
          },
          { passive: true },
        );
        modal.addEventListener(
          "touchend",
          (e) => {
            const t = e.changedTouches[0];
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            // Only navigate when the swipe is clearly horizontal so vertical
            // scrolling of a long review isn't hijacked.
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
              navigateReview(dx < 0 ? 1 : -1);
            }
          },
          { passive: true },
        );

        // Close on Escape key
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && modal.classList.contains("active")) {
            closeModal();
          }
        });
      });

      // Arrow keys move between reviews while one is open
      document.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable)
        ) {
          return;
        }
        if (!activeReview()) return;
        e.preventDefault();
        // A key press doesn't produce a click event, so play the click sound
        // manually — only when a review actually switches.
        if (navigateReview(e.key === "ArrowLeft" ? -1 : 1)) {
          ClickAudio.playClick();
        }
      });
    }, 100);

    // One room for the whole note: the machines and the racks share a palette,
    // so they are themed together. No tallies above them — the films are the
    // page; counting them again in a strip of type adds nothing.
    return `<div class="reel-room">${renderedSections.join("")}</div>`;
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

    const attr = (value: string) => value.replace(/"/g, "&quot;");

    const slugFor = (title: string) => title.toLowerCase().replace(/[^\w]+/g, "-");
    // First visit: the page opens with every playlist folded, so the reader
    // sees the shape of the library rather than ~3,000 rows. The moment they
    // touch a chevron we remember their choice and stop deciding for them.
    const firstVisit = !this.hasCollapsePreference();
    const allSlugs = sections.map((section) => slugFor(section.title));
    if (firstVisit) this.setCollapsedSections(allSlugs);
    const collapsedSections = new Set(firstVisit ? allSlugs : this.getCollapsedSections());

    const renderedSections = sections.map((section, sIndex) => {
      const songListItems = section.songs.map((song, index) => {
        return `
          <div class="song-list-item" data-video-id="${song.videoId}" data-section-index="${sIndex}" data-song-index="${index}">
            <div class="sl-col-index">
              <span class="track-number">${index + 1}</span>
              <span class="play-icon-hover">▶</span>
            </div>
            <div class="sl-col-title" data-title="${attr(song.title)}" data-artist="${attr(song.artist)}">${song.title}</div>
            <div class="sl-col-artist">${song.artist || "Unknown Artist"}</div>
            <div class="sl-col-actions">
              <button class="sl-more-btn" type="button" aria-haspopup="menu" aria-label="More options for ${attr(song.title)}" data-section-index="${sIndex}" data-song-index="${index}">⋯</button>
            </div>
          </div>
        `;
      });

      const sectionActions =
        section.songs.length > 0
          ? `<div class="section-actions">
              <button class="play-all-btn" data-section-index="${sIndex}"><span class="play-icon-small">▶</span> Play All</button>
              <button class="play-all-more-btn" type="button" aria-haspopup="menu" aria-label="More options for the ${attr(section.title)} playlist" data-section-index="${sIndex}">⋯</button>
            </div>`
          : "";

      const slug = slugFor(section.title);
      const collapsed = collapsedSections.has(slug);

      return `
        <div class="section-header">
          <div class="section-title-wrapper">
            <button class="section-toggle" type="button" data-section-index="${sIndex}" data-section-slug="${slug}" aria-expanded="${collapsed ? "false" : "true"}" aria-controls="song-list-${slug}" aria-label="${collapsed ? "Expand" : "Collapse"} ${attr(section.title)} playlist">
              <span class="section-chevron" aria-hidden="true">▾</span>
            </button>
            <h2 id="${slug}" class="section-title" data-section-index="${sIndex}" data-section-slug="${slug}">${section.title}</h2>
            <span class="playlist-length">${section.songs.length} songs</span>
          </div>
          ${sectionActions}
        </div>
        <div class="song-list${collapsed ? " collapsed" : ""}" id="song-list-${slug}" data-section-index="${sIndex}">
          <div class="song-list-header-row">
            <div class="sl-col-index">#</div>
            <div class="sl-col-title">Title</div>
            <div class="sl-col-artist">Artist</div>
            <div class="sl-col-actions" aria-hidden="true"></div>
          </div>
          ${songListItems.join("")}
        </div>
      `;
    });

    // Listeners are attached once the markup has landed in the DOM.
    setTimeout(() => this.setupSongListInteractions(sections), 100);

    const toolbar = `
      <div class="song-list-toolbar">
        <button class="songs-collapse-all" type="button">Collapse all</button>
        <button class="songs-expand-all" type="button">Expand all</button>
      </div>
    `;

    return Promise.resolve(toolbar + renderedSections.join(""));
  }

  // ── Songs: collapsing playlists, the per-song ⋯ menu, the queue ────────
  private static readonly SONGS_COLLAPSE_KEY = "songs-collapsed-sections";

  private getCollapsedSections(): string[] {
    try {
      const raw = localStorage.getItem(NotePage.SONGS_COLLAPSE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
    } catch {
      return [];
    }
  }

  private setSectionCollapsed(slug: string, collapsed: boolean): void {
    const current = new Set(this.getCollapsedSections());
    if (collapsed) current.add(slug);
    else current.delete(slug);
    this.setCollapsedSections([...current]);
  }

  /** Has the reader ever folded/unfolded a playlist? Until they have, we fold
   *  them all by default; after that the stored state is theirs, not ours. */
  private hasCollapsePreference(): boolean {
    try {
      return localStorage.getItem(NotePage.SONGS_COLLAPSE_KEY) !== null;
    } catch {
      return true; // private browsing: don't pretend we have a preference
    }
  }

  private setCollapsedSections(slugs: string[]): void {
    try {
      localStorage.setItem(NotePage.SONGS_COLLAPSE_KEY, JSON.stringify(slugs));
    } catch { /* private browsing — the page still works, it just forgets */ }
  }

  private copyText(text: string): Promise<void> {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(area);
        if (ok) resolve();
        else reject(new Error("copy command failed"));
      } catch (error) {
        reject(error);
      }
    });
  }

  private setupSongListInteractions(
    sections: { title: string; songs: { title: string; artist: string; url: string; videoId: string }[] }[],
  ): void {
    const player = MusicPlayerService.getInstance();

    const tracksFor = (sIndex: number): Track[] =>
      (sections[sIndex]?.songs || []).map((s) => ({ title: s.title, artist: s.artist, videoId: s.videoId }));

    // ── Collapse / expand a playlist by clicking its title ──
    const toggleSection = (el: HTMLElement) => {
      const sIndex = el.getAttribute("data-section-index") || "";
      const slug = el.getAttribute("data-section-slug") || "";
      const list = document.querySelector<HTMLElement>(`.song-list[data-section-index="${sIndex}"]`);
      if (!list) return;
      const collapsed = !list.classList.contains("collapsed");
      list.classList.toggle("collapsed", collapsed);
      document.querySelectorAll<HTMLElement>(`.section-toggle[data-section-index="${sIndex}"]`).forEach((btn) => {
        btn.setAttribute("aria-expanded", String(!collapsed));
      });
      if (slug) this.setSectionCollapsed(slug, collapsed);
    };

    document.querySelectorAll<HTMLElement>(".section-toggle, .section-title").forEach((el) => {
      el.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).closest(".heading-anchor")) return;
        toggleSection(el);
      });
    });

    const setAllCollapsed = (collapsed: boolean) => {
      document.querySelectorAll<HTMLElement>(".song-list").forEach((list) => {
        list.classList.toggle("collapsed", collapsed);
        const sIndex = list.getAttribute("data-section-index") || "";
        const title = document.querySelector<HTMLElement>(`.section-title[data-section-index="${sIndex}"]`);
        const slug = title?.getAttribute("data-section-slug") || "";
        document.querySelectorAll<HTMLElement>(`.section-toggle[data-section-index="${sIndex}"]`).forEach((btn) => {
          btn.setAttribute("aria-expanded", String(!collapsed));
        });
        if (slug) this.setSectionCollapsed(slug, collapsed);
      });
    };
    document.querySelector(".songs-collapse-all")?.addEventListener("click", () => setAllCollapsed(true));
    document.querySelector(".songs-expand-all")?.addEventListener("click", () => setAllCollapsed(false));

    // ── Play All (shuffled) ──
    document.querySelectorAll<HTMLElement>(".play-all-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sIndex = parseInt(btn.getAttribute("data-section-index") || "0", 10);
        const tracks = tracksFor(sIndex);
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
        }
        player.playQueue(tracks, 0);
      });
    });

    // ── Click a row to play its playlist from there ──
    document.querySelectorAll<HTMLElement>(".song-list-item").forEach((item) => {
      item.addEventListener("click", () => {
        const sIndex = parseInt(item.getAttribute("data-section-index") || "0", 10);
        const songIndex = parseInt(item.getAttribute("data-song-index") || "0", 10);
        player.playQueue(tracksFor(sIndex), songIndex);
      });
    });

    // ── Per-song ‥ menu ──
    if (songMenuCleanup) songMenuCleanup();

    const menu = document.createElement("div");
    menu.id = "song-actions-menu";
    menu.className = "sl-actions-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    document.body.appendChild(menu);

    // A menu is navigable from the keyboard the way role="menu" promises.
    attachMenuKeys(menu);

    let openTrack: Track | null = null;
    /** The playlist menu is open instead: which section, and its songs. */
    let openPlaylist: { index: number; tracks: Track[] } | null = null;
    /** The button the open menu belongs to — focus returns here when it goes. */
    let menuOpener: HTMLElement | null = null;

    const closeMenu = () => {
      // Only pull focus back if the menu actually had it: on an outside click
      // or a scroll the reader's attention is elsewhere, and stealing it back
      // to the button would be worse than leaving it alone.
      const hadFocus = menu.contains(document.activeElement);
      menu.hidden = true;
      openTrack = null;
      openPlaylist = null;
      delete menu.dataset.kind;
      if (hadFocus && menuOpener && menuOpener.isConnected) menuOpener.focus();
      menuOpener = null;
    };

    /** Drop the menu by its button, flipping it up if it would run off the
     *  bottom of the window — the same maths for both menus. */
    const positionMenu = (btn: HTMLElement) => {
      menu.hidden = false;
      const rect = btn.getBoundingClientRect();
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      let top = rect.bottom + 6;
      if (top + height > window.innerHeight - 8) top = rect.top - height - 6;
      menu.style.left = `${left}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    };

    /** Put the cursor on the menu's first item once it is placed. */
    const focusFirstItem = () => {
      const first = menu.querySelector<HTMLButtonElement>(".sl-menu-item:not([disabled])");
      first?.focus();
    };

    const openMenu = (btn: HTMLElement, track: Track) => {
      openTrack = track;
      openPlaylist = null;
      menu.dataset.kind = "song";
      const queued = player.isInQueue(track.videoId);
      menu.innerHTML = `
        <button class="sl-menu-item" type="button" role="menuitem" data-action="play"><span class="sl-menu-icon" aria-hidden="true">▶</span> Play now</button>
        <button class="sl-menu-item" type="button" role="menuitem" data-action="next"><span class="sl-menu-icon" aria-hidden="true">⏭</span> Play next</button>
        <button class="sl-menu-item" type="button" role="menuitem" data-action="queue"${queued ? " disabled" : ""}><span class="sl-menu-icon" aria-hidden="true">${queued ? "✓" : "＋"}</span> ${queued ? "Already in queue" : "Add to queue"}</button>
        <button class="sl-menu-item" type="button" role="menuitem" data-action="copy"><span class="sl-menu-icon" aria-hidden="true">🔗</span> Copy link</button>
      `;
      menuOpener = btn;
      positionMenu(btn);
      focusFirstItem();
    };

    /**
     * The playlist's own menu, sitting beside Play All: the same four verbs,
     * but aimed at every song in the section rather than at one row — so a
     * whole playlist can be queued, slotted in next, or linked to in one go.
     */
    const openPlaylistMenu = (btn: HTMLElement, sIndex: number) => {
      const tracks = tracksFor(sIndex);
      const queuedCount = tracks.filter((t) => player.isInQueue(t.videoId)).length;
      const allQueued = tracks.length > 0 && queuedCount === tracks.length;
      const missing = tracks.length - queuedCount;
      openTrack = null;
      openPlaylist = { index: sIndex, tracks };
      menu.dataset.kind = "playlist";
      menu.innerHTML = `
        <button class="sl-menu-item" type="button" role="menuitem" data-action="play"><span class="sl-menu-icon" aria-hidden="true">▶</span> Play in order</button>
        <button class="sl-menu-item" type="button" role="menuitem" data-action="next"><span class="sl-menu-icon" aria-hidden="true">⏭</span> Play next</button>
        <button class="sl-menu-item" type="button" role="menuitem" data-action="queue"${allQueued ? " disabled" : ""}><span class="sl-menu-icon" aria-hidden="true">${allQueued ? "✓" : "＋"}</span> ${allQueued ? "Whole playlist queued" : queuedCount > 0 ? `Add ${missing} missing to queue` : `Add all ${tracks.length} to queue`}</button>
        <button class="sl-menu-item" type="button" role="menuitem" data-action="copy"><span class="sl-menu-icon" aria-hidden="true">🔗</span> Copy link</button>
      `;
      menuOpener = btn;
      positionMenu(btn);
      focusFirstItem();
    };

    document.querySelectorAll<HTMLElement>(".sl-more-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ClickAudio.playClick();
        const sIndex = parseInt(btn.getAttribute("data-section-index") || "0", 10);
        const songIndex = parseInt(btn.getAttribute("data-song-index") || "0", 10);
        const song = sections[sIndex]?.songs[songIndex];
        if (!song) return;
        const key = `${sIndex}:${songIndex}`;
        if (!menu.hidden && menu.dataset.key === key) {
          closeMenu();
          return;
        }
        menu.dataset.key = key;
        openMenu(btn, { title: song.title, artist: song.artist, videoId: song.videoId });
      });
    });

    // The playlist's own ⋯, beside Play All.
    document.querySelectorAll<HTMLElement>(".play-all-more-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        ClickAudio.playClick();
        const sIndex = parseInt(btn.getAttribute("data-section-index") || "0", 10);
        const key = `p${sIndex}`;
        if (!menu.hidden && menu.dataset.kind === "playlist" && menu.dataset.key === key) {
          closeMenu();
          return;
        }
        menu.dataset.key = key;
        openPlaylistMenu(btn, sIndex);
      });
    });

    menu.addEventListener("click", (e) => {
      e.stopPropagation();
      ClickAudio.playClick();
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>(".sl-menu-item");
      if (!item || item.disabled) return;
      const action = item.getAttribute("data-action");

      // ── The playlist's menu: the same four verbs, aimed at every song in
      // this section rather than at one row. ──
      if (menu.dataset.kind === "playlist") {
        const playlist = openPlaylist;
        if (!playlist) return;
        if (action === "play") {
          player.playQueue(playlist.tracks, 0);
          closeMenu();
        } else if (action === "next") {
          player.playNextMany(playlist.tracks);
          closeMenu();
        } else if (action === "queue") {
          const added = player.addManyToQueue(playlist.tracks);
          item.innerHTML = added
            ? `<span class="sl-menu-icon" aria-hidden="true">✓</span> ${added} added to queue`
            : `<span class="sl-menu-icon" aria-hidden="true">✓</span> Already queued`;
          window.setTimeout(closeMenu, 1100);
        } else if (action === "copy") {
          const title = sections[playlist.index]?.title || "";
          const slug = title.toLowerCase().replace(/[^\w]+/g, "-");
          const url = `${location.origin}${location.pathname}#${slug}`;
          this.copyText(url).then(() => {
            item.innerHTML = `<span class="sl-menu-icon" aria-hidden="true">✓</span> Link copied`;
            window.setTimeout(closeMenu, 800);
          }).catch(() => {
            item.innerHTML = `<span class="sl-menu-icon" aria-hidden="true">⚠</span> Copy failed`;
            window.setTimeout(closeMenu, 1200);
          });
        }
        return;
      }

      if (!openTrack) return;
      const [sIndex, songIndex] = (menu.dataset.key || "0:0").split(":").map((n) => parseInt(n, 10));
      const track = openTrack;

      if (action === "play") {
        player.playQueue(tracksFor(sIndex), songIndex);
        closeMenu();
      } else if (action === "next") {
        player.playNext(track);
        closeMenu();
      } else if (action === "queue") {
        player.addToQueue(track);
        closeMenu();
      } else if (action === "copy") {
        const url = sections[sIndex]?.songs[songIndex]?.url || `https://www.youtube.com/watch?v=${track.videoId}`;
        this.copyText(url).then(() => {
          item.innerHTML = `<span class="sl-menu-icon" aria-hidden="true">✓</span> Link copied`;
          window.setTimeout(closeMenu, 800);
        }).catch(() => {
          item.innerHTML = `<span class="sl-menu-icon" aria-hidden="true">⚠</span> Copy failed`;
          window.setTimeout(closeMenu, 1200);
        });
      }
    });

    // Close on an outside click, Escape, or scroll.
    const onDocClick = (e: Event) => {
      if (menu.hidden) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(".sl-actions-menu") || target?.closest(".sl-more-btn") || target?.closest(".play-all-more-btn")) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    const onScroll = () => closeMenu();
    const onPop = () => closeMenu();
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("popstate", onPop);

    // ── Mark the rows that are already queued ──
    const markQueuedRows = (tracks: Track[]) => {
      const ids = new Set(tracks.map((t) => t.videoId));
      document.querySelectorAll<HTMLElement>(".song-list-item").forEach((row) => {
        row.classList.toggle("in-queue", ids.has(row.getAttribute("data-video-id") || ""));
      });
    };
    const queueListener = (event: Event) => {
      const detail = (event as CustomEvent<{ tracks?: Track[] }>).detail;
      markQueuedRows(detail?.tracks || []);
    };
    document.addEventListener("music-player-queue-change", queueListener);
    markQueuedRows(player.getQueue());

    songMenuCleanup = () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("music-player-queue-change", queueListener);
      menu.remove();
      songMenuCleanup = null;
    };
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
        <h2 id="${section.title.toLowerCase().replace(/\s+/g, "-")}">${section.title}</h2>
        <div class="paper-grid">${paperCards.join("")}</div>
      `;
    });

    return renderedSections.join("");
  }

  private async renderBooks(content: string): Promise<string> {
    // Covers and authors were resolved at build time into the catalog, so the
    // shelf paints straight from it — no Open Library lookup, no waiting on a
    // request to fill in a caption.
    await ensureCatalog();

    const lines = content.split("\n");
    const sections: any[] = [];
    let currentSection: any = null;
    let currentBook: any = null;

    lines.forEach((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine === "") return;

      if (line.startsWith("## ")) {
        if (currentBook && currentSection) {
          currentSection.books.push({ title: currentBook.title, review: currentBook.reviewLines.join("\n"), isRead: currentBook.isRead });
          currentBook = null;
        }
        if (currentSection) sections.push(currentSection);
        currentSection = { title: line.replace("## ", "").trim(), books: [] };
      } else if (trimmedLine.startsWith(">")) {
        if (currentBook) currentBook.reviewLines.push(trimmedLine.substring(1).trim());
      } else if (currentSection) {
        if (currentBook) {
          currentSection.books.push({ title: currentBook.title, isbn: currentBook.isbn, review: currentBook.reviewLines.join("\n"), isRead: currentBook.isRead });
        }
        const match = trimmedLine.match(/^(?:\[([ xX\u2713\u2714])\]\s*)?(.+)$/);
        if (match) {
          const isRead = match[1] && match[1].trim() !== "";
          let rawTitle = match[2].trim();
          let isbn: string | null = null;
          const isbnMatch = rawTitle.match(/\(([\d-]+)\)$/);
          if (isbnMatch) {
            isbn = isbnMatch[1].replace(/-/g, "");
            if ((isbn as string).length < 10 || (isbn as string).length > 13) isbn = null;
            else rawTitle = rawTitle.replace(isbnMatch[0], "").trim();
          }
          currentBook = { title: rawTitle, isbn, reviewLines: [], isRead: !!isRead };
        } else { currentBook = null; }
      }
    });

    if (currentBook && currentSection) {
      currentSection.books.push({ title: currentBook.title, isbn: currentBook.isbn, review: currentBook.reviewLines.join("\n"), isRead: currentBook.isRead });
    }
    if (currentSection && !sections.includes(currentSection)) sections.push(currentSection);

    const allBooks = sections.flatMap((s: any) => s.books);

    const detailsFor = (book: any) => bookDetails(book);

    // Stable hue from string hash
    const hashHue = (str: string) => {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
      return Math.abs(h) % 360;
    };

    const coverFor = (book: any) => (detailsFor(book) || {}).cover || "";

    const escapeAttr = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;");

    // One focusable button per book. The ring positions them from JavaScript
    // (the transform is inline so a move can animate), so the markup itself
    // only carries content.
    const itemsHtml = allBooks.map((book: any, i: number) => {
      const hue = hashHue(book.title);
      const cover = coverFor(book);
      const readBadge = book.isRead ? `<span class="shelf-book-read" title="Read">&check;</span>` : "";
      const label = escapeAttr(book.title);
      // No inline --book-cover here: applyCover() is the single place that
      // loads the art, so each cover is fetched exactly once instead of once
      // as a CSS background and again as an Image.
      return `<button type="button" class="shelf-book" data-book-index="${i}" data-cover="${cover}" aria-label="${label}" style="--book-hue:${hue}">
  <span class="shelf-book-cover"><span class="shelf-book-label">${label}</span>${readBadge}</span>
</button>`;
    }).join("\n");

    const booksJson = JSON.stringify(
      allBooks.map((b: any) => {
        const details = detailsFor(b);
        return {
          ...b,
          author: (details && details.author) || "",
          cover: coverFor(b),
          hue: hashHue(b.title),
        };
      }),
    ).replace(/</g, "\\u003c");

    const total = String(allBooks.length).padStart(2, "0");
    return `
<section class="bookshelf-scene" aria-label="Library">
  <div class="shelf-top">
    <p class="shelf-heading">Library</p>
    <span class="shelf-count" id="shelf-count" aria-hidden="true">01 / ${total}</span>
  </div>
  <div class="shelf-stage-row">
    <button type="button" class="shelf-arrow" id="shelf-arrow-prev" aria-label="Previous book">&#8249;</button>
    <div class="shelf-stage" id="shelf-stage" tabindex="0" role="group" aria-roledescription="carousel" aria-label="Bookshelf — use the arrow buttons to browse one book at a time">
      <div class="shelf-ring" id="shelf-ring">${itemsHtml}</div>
    </div>
    <button type="button" class="shelf-arrow" id="shelf-arrow-next" aria-label="Next book">&#8250;</button>
  </div>
  <div class="shelf-caption">
    <div class="shelf-caption-text">
      <p class="shelf-title" id="shelf-title"></p>
      <p class="shelf-author" id="shelf-author"></p>
    </div>
    <button type="button" class="shelf-read-btn" id="shelf-read-btn">Read Notes</button>
  </div>
  <p class="shelf-status" id="shelf-status" role="status" aria-live="polite"></p>
</section>
<div class="shelf-modal" id="shelf-modal" role="dialog" aria-modal="true" aria-label="Book notes">
  <div class="shelf-modal-backdrop" id="shelf-modal-backdrop"></div>
  <button class="modal-nav-btn modal-nav-prev" id="shelf-modal-prev" aria-label="Previous book">&#8249;</button>
  <button class="modal-nav-btn modal-nav-next" id="shelf-modal-next" aria-label="Next book">&#8250;</button>
  <div class="shelf-modal-box" id="shelf-modal-box" role="document">
    <button class="shelf-modal-close" id="shelf-modal-close" aria-label="Close">&#10005;</button>
    <div class="shelf-panel-body" id="shelf-panel-body">
      <img class="shelf-panel-cover" id="shelf-panel-cover" alt="" hidden>
      <h2 class="shelf-panel-title" id="shelf-panel-title"></h2>
      <div class="shelf-panel-meta" id="shelf-panel-meta"></div>
      <hr class="shelf-modal-divider">
      <div class="shelf-panel-review" id="shelf-panel-review"></div>
    </div>
  </div>
</div>
<script type="application/json" id="shelf-books-data">${booksJson}</script>`;
  }

  private setupBookshelfInteractivity(): void {
    // `track` is the ring the books live in — the helpers below find books
    // through it, and cover art is applied per book from here.
    const track = document.getElementById("shelf-ring");
    const stage = document.getElementById("shelf-stage");
    const modal = document.getElementById("shelf-modal");
    const backdrop = document.getElementById("shelf-modal-backdrop");
    const closeBtn = document.getElementById("shelf-modal-close");
    const panelTitle = document.getElementById("shelf-panel-title");
    const panelMeta = document.getElementById("shelf-panel-meta");
    const panelReview = document.getElementById("shelf-panel-review");
    const dataEl = document.getElementById("shelf-books-data");
    if (!track || !stage || !modal || !dataEl) return;

    // The book overlay is a dialog too: focus goes in, stays in, and returns
    // to the shelf when it closes.
    const shelfTrap = new FocusTrap(modal);

    // Move modal to body so it overlays everything
    document.body.appendChild(modal);

    let booksData: any[] = [];
    try { booksData = JSON.parse(dataEl.textContent || "[]"); } catch (_) { return; }

    // Reveal the cover art as soon as the image is available; until then the
    // book keeps its solid colour as a graceful fallback. Covers come in
    // different aspect ratios, so once the art loads, size the book to the
    // cover's native ratio — that way covers always show complete instead of
    // being cropped at the edges to fill a fixed width.
    const styleBookWithCover = (
      el: HTMLElement,
      cover: string,
      img: HTMLImageElement | null,
      cached: CoverImageCacheEntry | null,
    ) => {
      el.classList.add("has-cover");
      // Cache-first: persisted bytes render straight from localStorage;
      // otherwise fall back to the remote URL.
      const src = cached ? cached.data : cover;
      el.style.setProperty("--book-cover", `url('${src}')`);
      const w = cached ? cached.w : img ? img.naturalWidth : 0;
      const h = cached ? cached.h : img ? img.naturalHeight : 0;
      if (w > 0 && h > 0) {
        const heightPx = parseFloat(getComputedStyle(el).height) || 174.4;
        const widthPx = (heightPx * w) / h;
        // keep extreme ratios from making books absurdly thin or wide —
        // square-ish covers like Seinfeld's legitimately get a wider book
        const clamped = Math.min(Math.max(widthPx, 88), 152);
        el.style.setProperty("--book-width", `${(clamped / 16).toFixed(2)}rem`);
      }
    };

    const applyCover = (el: HTMLElement, cover: string) => {
      // Already persisted as a data URL? Render straight from localStorage —
      // no network call for this cover at all.
      const cached = getCachedCoverImage(cover);
      if (cached) {
        styleBookWithCover(el, cover, null, cached);
        return;
      }
      // Already fetched this session (e.g. by the review modal)? Just apply it.
      const existing = loadedCovers.get(cover);
      if (existing && existing.complete) {
        styleBookWithCover(el, cover, existing, null);
        persistCoverImage(cover, existing);
        return;
      }
      // Load once with CORS so the bytes can be persisted; the shelf then
      // renders from the same bytes (data URL) — one request per cover.
      const img = new Image();
      img.onload = () => {
        loadedCovers.set(cover, img);
        styleBookWithCover(el, cover, img, persistCoverImage(cover, img));
      };
      img.onerror = () => {
        // Host refused CORS — fall back to a plain load (renders, but the
        // bytes can't be persisted).
        const plain = new Image();
        plain.onload = () => {
          loadedCovers.set(cover, plain);
          styleBookWithCover(el, cover, plain, null);
        };
        plain.src = cover;
      };
      img.crossOrigin = "anonymous";
      img.src = cover;
    };

    track.querySelectorAll<HTMLElement>(".shelf-book").forEach((bookEl) => {
      const cover = bookEl.dataset.cover;
      if (cover) applyCover(bookEl, cover);
    });

    // ── The ring ────────────────────────────────────────────
    // The shelf is a coverflow, not a scroll container: every book is placed
    // from the active index, so the open book always sits square-on in the
    // middle of the room while its neighbours step sideways, recede and turn
    // away — and one gesture can only ever move one book.
    let active = 0;

    const titleEl = document.getElementById("shelf-title");
    const authorEl = document.getElementById("shelf-author");
    const countEl = document.getElementById("shelf-count");
    const statusEl = document.getElementById("shelf-status");
    const readBtn = document.getElementById("shelf-read-btn") as HTMLButtonElement | null;
    const prevBtn = document.getElementById("shelf-arrow-prev") as HTMLButtonElement | null;
    const nextBtn = document.getElementById("shelf-arrow-next") as HTMLButtonElement | null;
    const items = Array.from(track.querySelectorAll<HTMLElement>(".shelf-book"));

    const STEP_TILT = 26; // degrees each step turns away from the viewer
    const STEP_Z = 150; // px each step recedes
    const RING_SPAN = 3; // books kept mounted either side of the active one

    const pad2 = (n: number) => String(n).padStart(2, "0");

    const setActive = (idx: number) => {
      if (!items.length) return;
      active = Math.max(0, Math.min(items.length - 1, idx));

      // Sideways travel is measured in book heights, not cover widths: the
      // covers arrive asynchronously and change width, the height never does.
      const unit = items[active].getBoundingClientRect().height || 200;

      items.forEach((el, i) => {
        const offset = i - active;
        const distance = Math.abs(offset);
        const away = distance > RING_SPAN;
        const x = offset * unit * 0.5 * (distance > 1 ? 0.86 : 1);
        const tilt = Math.max(-48, Math.min(48, offset * STEP_TILT));
        el.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, 0, ${-distance * STEP_Z}px) rotateY(${tilt.toFixed(1)}deg)`;
        el.style.opacity = away ? "0" : String(Math.max(0.22, 1 - distance * 0.19));
        el.style.zIndex = String(100 - distance);
        el.style.pointerEvents = away ? "none" : "";
        el.setAttribute("aria-hidden", away ? "true" : "false");
        el.tabIndex = offset === 0 ? 0 : -1;
        el.classList.toggle("shelf-book--active", offset === 0);
      });

      const book = booksData[active] || {};
      if (titleEl) titleEl.textContent = book.title || "";
      if (authorEl) {
        authorEl.textContent = book.author || (book.isRead ? "read" : "to read");
        authorEl.classList.toggle("is-placeholder", !book.author);
      }
      if (countEl) countEl.textContent = `${pad2(active + 1)} / ${pad2(items.length)}`;
      if (readBtn) {
        const hasNotes = !!(book.review && book.review.trim());
        readBtn.disabled = !hasNotes;
        readBtn.textContent = hasNotes ? "Read Notes" : "No notes yet";
      }
      if (statusEl) {
        statusEl.textContent = `Book ${active + 1} of ${items.length}: ${
          book.title || ""
        }${book.author ? ` by ${book.author}` : ""}`;
      }
      // Both the bottom arrows and the overlay's arrows grey out at the ends.
      if (prevBtn) prevBtn.disabled = active === 0;
      if (nextBtn) nextBtn.disabled = active === items.length - 1;

      syncBookNav(active);
    };

    const step = (dir: number): boolean => {
      const next = active + dir;
      if (next < 0 || next >= items.length) return false;
      setActive(next);
      return true;
    };

    // ── Wheel over the covers ───────────────────────────────
    // One scroll has one owner: a scroll begun on the covers turns books and
    // turns nothing else — the page never slides along underneath it, not even
    // once the ring runs out of books. A scroll begun anywhere else is left
    // completely alone, so a reader moving down the page whose cursor happens
    // to cross the shelf is not hijacked. Travel is measured, not gestures, so
    // scrolling on keeps turning; a short cooldown only stops one flick's
    // burst of events from blasting past several books at once.
    const WHEEL_STEP_PX = 60; // travel that means "one book"
    const WHEEL_OWN_PX = 12; // travel that settles whose scroll this is
    const WHEEL_COOLDOWN = 110; // ms between books, so a flick is not a jump
    const WHEEL_GESTURE_GAP = 320; // ms of quiet that begins a new scroll
    let wheelAcc = 0; // travel gathered since the last book
    let wheelDir = 0; // which way that travel is going
    let wheelLastTurn = 0; // when the last book turned
    let wheelAt = 0; // when the wheel last spoke
    let wheelOwns: boolean | null = null; // null until this scroll proves itself
    window.addEventListener(
      "wheel",
      (e) => {
        // whichever axis is asking, in pixels — a line or page delta from an
        // unusual device still counts for something
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        const dx = e.deltaX * unit;
        const dy = e.deltaY * unit;
        const travel = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
        if (!travel) return;

        const dir = travel > 0 ? 1 : -1;
        const now = performance.now();
        // a pause ends the scroll; the next notch picks its owner afresh
        if (now - wheelAt > WHEEL_GESTURE_GAP) {
          wheelOwns = null;
          wheelAcc = 0;
          wheelDir = 0;
        }
        wheelAt = now;

        // Already the page's scroll (or one that never touched the covers):
        // hand it straight back and never take it over.
        if (wheelOwns === false) return;
        if (!(e.target instanceof Node) || !stage.contains(e.target)) {
          wheelOwns = false;
          return;
        }

        if (dir !== wheelDir) {
          // Turning around starts its own distance rather than spending the
          // travel the reader just cancelled.
          wheelAcc = 0;
          wheelDir = dir;
        }
        wheelAcc += travel;

        if (wheelOwns === null) {
          if (Math.abs(wheelAcc) < WHEEL_OWN_PX) {
            // Too little travel yet to tell which way the scroll means, and a
            // flick's opening event can point the wrong way — so hold the page
            // while it makes up its mind rather than let a scroll begun on the
            // covers creep down the page underneath it.
            e.preventDefault();
            return;
          }
          const canTurn = dir > 0 ? active < items.length - 1 : active > 0;
          if (!canTurn) {
            // nowhere to go this way: the page keeps the whole scroll
            wheelOwns = false;
            wheelAcc = 0;
            return;
          }
          wheelOwns = true;
          // the travel that settled it still counts towards the next book
        }

        // The scroll is the shelf's now, and the page stays exactly where it is.
        e.preventDefault();
        if (Math.abs(wheelAcc) < WHEEL_STEP_PX) return;
        if (now - wheelLastTurn < WHEEL_COOLDOWN) return;
        wheelAcc = 0;
        wheelLastTurn = now;
        step(dir);
      },
      { passive: false },
    );

    // On touch one horizontal flick moves one book; vertical stays with the
    // page (`touch-action: pan-y` on the stage keeps scrolling working).
    let touchX = 0;
    let touchY = 0;
    stage.addEventListener(
      "touchstart",
      (e) => {
        touchX = e.changedTouches[0].clientX;
        touchY = e.changedTouches[0].clientY;
      },
      { passive: true },
    );
    stage.addEventListener(
      "touchend",
      (e) => {
        const t = e.changedTouches[0];
        const dx = t.clientX - touchX;
        const dy = t.clientY - touchY;
        if (Math.abs(dx) < 34 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        if (step(dx < 0 ? 1 : -1)) ClickAudio.playClick();
      },
      { passive: true },
    );

    // Keyboard: the stage takes focus, so ← / → work without a mouse. While
    // the notes overlay is open it owns the arrow keys instead — the stage
    // keeps focus behind it, so without this guard a key would step twice.
    stage.addEventListener("keydown", (e) => {
      if (modal.classList.contains("shelf-modal--open")) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (step(-1)) ClickAudio.playClick();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (step(1)) ClickAudio.playClick();
      } else if (e.key === "Home") {
        e.preventDefault();
        setActive(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setActive(items.length - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openBook(active);
      }
    });

    if (readBtn) {
      readBtn.addEventListener("click", () => openBook(active));
    }
    // ── Arrow navigation ────────────────────────────────────
    // Side chevrons scroll the shelf by a page, work with touch taps, and
    // disable themselves when there is nothing to scroll on that side.
    prevBtn?.addEventListener("click", () => {
      if (step(-1)) ClickAudio.playClick();
    });
    nextBtn?.addEventListener("click", () => {
      if (step(1)) ClickAudio.playClick();
    });

    const closeModal = () => {
      modal.classList.remove("shelf-modal--open");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
      shelfTrap.deactivate();
      // The open book stays highlighted on the shelf behind the overlay.
    };

    // Prev/next controls inside the modal: disabled at the ends of the shelf
    const shelfPrevBtn = document.getElementById("shelf-modal-prev") as HTMLButtonElement | null;
    const shelfNextBtn = document.getElementById("shelf-modal-next") as HTMLButtonElement | null;
    const syncBookNav = (idx: number) => {
      if (shelfPrevBtn) shelfPrevBtn.disabled = idx <= 0;
      if (shelfNextBtn) shelfNextBtn.disabled = idx >= booksData.length - 1;
    };

    // Author and reading state under the title — written as a hoisted
    // declaration so the author lookup above can refresh it in place.
    function renderPanelMeta(book: any): void {
      if (!panelMeta) return;
      panelMeta.innerHTML = `${
        book.author ? `<span class="shelf-panel-author">${book.author}</span>` : ""
      }<span class="${book.isRead ? "shelf-badge-read" : "shelf-badge-unread"}">${
        book.isRead ? "&#10003; Read" : "To Read"
      }</span>`;
    }

    // Show a book's notes in the overlay ("read notes")
    const openBook = (idx: number) => {
      const book = booksData[idx];
      if (!book) return;
      // Keep the ring and the overlay on the same book whichever way the
      // reader got here — button, arrow, side book, key or swipe.
      setActive(idx);

      if (panelTitle) panelTitle.textContent = book.title;
      renderPanelMeta(book);
      if (panelReview) panelReview.innerHTML = book.review
        ? book.review.replace(/\n/g, "<br>")
        : '<em style="opacity:0.5">No notes yet.</em>';

      const coverEl = document.getElementById("shelf-panel-cover") as HTMLImageElement | null;
      if (coverEl) {
        if (book.cover) {
          // Cache-first: persisted bytes render straight from localStorage.
          // Otherwise reuse the cover the shelf already fetched (identical
          // URL, served from the browser cache) — never a second fetch.
          const cachedCover = getCachedCoverImage(book.cover);
          if (cachedCover) {
            coverEl.src = cachedCover.data;
          } else {
            const alreadyLoaded = loadedCovers.get(book.cover);
            if (alreadyLoaded && alreadyLoaded.complete) {
              coverEl.src = alreadyLoaded.src;
            } else {
              coverEl.src = book.cover;
              // Remember + persist it so the next open (and the shelf) can
              // reuse it without another request.
              const img = new Image();
              img.onload = () => {
                loadedCovers.set(book.cover, img);
                persistCoverImage(book.cover, img);
              };
              img.crossOrigin = "anonymous";
              img.src = book.cover;
            }
          }
          coverEl.hidden = false;
        } else {
          coverEl.removeAttribute("src");
          coverEl.hidden = true;
        }
      }

      // Compensate for the scrollbar disappearing so the page doesn't jump
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
      // Always open at the top of the notes — the box keeps the position it
      // was left at on the previous book otherwise.
      const box = document.getElementById("shelf-modal-box");
      if (box) box.scrollTop = 0;
      modal.classList.add("shelf-modal--open");
      shelfTrap.activate(
        document.getElementById("shelf-modal-close") as HTMLElement | null,
      );

      syncBookNav(idx);
    };

    // Move to the previous/next book in shelf order (buttons, arrow keys, swipe);
    // returns true when a book was actually switched
    const navigateBook = (dir: 1 | -1): boolean => {
      if (!modal.classList.contains("shelf-modal--open")) return false;
      const nextIdx = active + dir;
      if (nextIdx < 0 || nextIdx >= booksData.length) return false;
      openBook(nextIdx);
      return true;
    };

    // Clicking a cover brings that book to the middle; clicking the cover
    // already in the middle opens its notes. The book is resolved from the
    // pointer position rather than from the event target, because the covers
    // overlap in 3D — the browser's hit test can land on a book stacked in
    // front of the one under the cursor.
    const bookAt = (x: number, y: number): number => {
      const centred = items[active] && items[active].getBoundingClientRect();
      if (
        centred &&
        x >= centred.left &&
        x <= centred.right &&
        y >= centred.top &&
        y <= centred.bottom
      ) {
        return active;
      }
      let nearest = -1;
      let nearestDistance = Infinity;
      items.forEach((el, i) => {
        if (i === active || Math.abs(i - active) > RING_SPAN) return;
        const rect = el.getBoundingClientRect();
        if (x < rect.left - 6 || x > rect.right + 6) return;
        if (y < rect.top - 6 || y > rect.bottom + 6) return;
        const distance = Math.abs(x - (rect.left + rect.right) / 2);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = i;
        }
      });
      return nearest;
    };

    stage.addEventListener("click", (e) => {
      const clicked = (e.target as HTMLElement | null)?.closest?.(
        ".shelf-book",
      ) as HTMLElement | null;
      // Keyboard activation carries no coordinates, so trust the button.
      const idx =
        e.detail === 0 && clicked
          ? parseInt(clicked.dataset.bookIndex || "0", 10)
          : bookAt(e.clientX, e.clientY);
      if (idx < 0) return;
      if (idx === active) {
        openBook(idx);
        return;
      }
      setActive(idx);
      ClickAudio.playClick();
    });

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    shelfPrevBtn?.addEventListener("click", () => {
      navigateBook(-1);
    });
    shelfNextBtn?.addEventListener("click", () => {
      navigateBook(1);
    });

    // Arrow keys move between books while the modal is open
    document.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (!modal.classList.contains("shelf-modal--open")) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      // A key press doesn't produce a click event, so play the click sound
      // manually — only when a book actually switches.
      if (navigateBook(e.key === "ArrowLeft" ? -1 : 1)) {
        ClickAudio.playClick();
      }
    });

    // Paint the first book, and re-measure whenever the panel changes size
    // (the step is derived from the book size, which is responsive).
    setActive(0);
    let resizeTimer: number | undefined;
    window.addEventListener("resize", () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => setActive(active), 120);
    });

    // Entrance fade: once the shelf scrolls into view, fade the row in
    const scene = document.querySelector(".bookshelf-scene");
    if (scene) {
      if ("IntersectionObserver" in window) {
        const io = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                scene.classList.add("shelf-inview");
                io.disconnect();
              }
            });
          },
          { threshold: 0.15 },
        );
        io.observe(scene);
      } else {
        scene.classList.add("shelf-inview");
      }
    }

    // Swipe left/right to move between books on touch devices
    let swipeStartX = 0, swipeStartY = 0;
    modal.addEventListener(
      "touchstart",
      (e) => {
        const t = e.changedTouches[0];
        swipeStartX = t.clientX;
        swipeStartY = t.clientY;
      },
      { passive: true },
    );
    modal.addEventListener(
      "touchend",
      (e) => {
        const t = e.changedTouches[0];
        const dx = t.clientX - swipeStartX;
        const dy = t.clientY - swipeStartY;
        // Only navigate when the swipe is clearly horizontal so vertical
        // scrolling of a long review isn't hijacked.
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          navigateBook(dx < 0 ? 1 : -1);
        }
      },
      { passive: true },
    );
  }
}
