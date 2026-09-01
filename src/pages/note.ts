import { AbstractView } from "../router";
import { NoteService } from "../services/note";
import { MusicPlayerService, Track } from "../services/player";
import { Carousel } from "../components/carousel";
import { PhotoService } from "../services/photo";

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
                }
                this.setupTableOfContents(element);
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
      // Skip headings inside movie, song or recipe cards (except recipe titles)
      if (
        heading.closest(".movie-card") ||
        heading.closest(".song-card") ||
        (heading.closest(".recipe-card") && !heading.classList.contains("recipe-title"))
      ) {
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
      // Add a hoverable anchor link to allow copying the deep link
      if (!heading.querySelector(".heading-anchor") && !heading.closest(".bucket-card")) {
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

    document.querySelectorAll(".bucket-card").forEach((card) => {
      card.addEventListener("click", () => {
        const bucketId = (card as HTMLElement).dataset.bucketId;
        if (bucketId) {
          const modal = document.getElementById(bucketId);
          if (modal) {
            modal.classList.add("active");
            document.body.style.overflow = "hidden";
          }
        }
      });
    });

    document.querySelectorAll(".bucket-modal").forEach((modal) => {
      const closeModal = () => {
        modal.classList.remove("active");
        document.body.style.overflow = "";
      };
      modal.querySelector(".bucket-modal-backdrop")?.addEventListener("click", closeModal);
      modal.querySelector(".bucket-modal-close")?.addEventListener("click", closeModal);
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("active")) closeModal();
      });
    });
  }

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

    // --- Instant render: show cards immediately, enrich with OMDB in background ---
    const renderedSections = sections.map((section) => {
      const movieItems = section.movies.map((movie: any, index: number) => {
        const movieId = `movie-${section.title.replace(/\s+/g, "-")}-${index}`;
        const hasReview = movie.review && movie.review.trim() !== "";
        const seenInd =
          movie.isSeen && !movie.inTheatre
            ? '<span class="seen-indicator" title="Viewed">✓ Watched</span>'
            : "";
        const theatreInd = movie.inTheatre
          ? '<span class="theatre-indicator" title="Watched in Theatre">🍿✓ Theatre</span>'
          : "";
        const reviewInd = hasReview
          ? '<span class="review-indicator" title="Click to see my review">\u270d\ufe0f</span>'
          : "";

        // Cache key: prefer imdbID for stable lookup
        const cacheKey = movie.imdbID
          ? `movie_imdb_${movie.imdbID}`
          : `movie_title_${movie.title}_${movie.year}`;
        const cached = localStorage.getItem(cacheKey);
        let cd = cached ? JSON.parse(cached) : null;
        if (cd && (!cd.poster || cd.poster === "N/A")) {
          cd = null;
        }

        const displayTitle = cd
          ? `${cd.title} (${cd.year})`
          : `${movie.title}${movie.year ? ` (${movie.year})` : ""}`;
        const displayDir = cd ? cd.director : "Loading\u2026";
        const displayPoster = cd ? cd.poster : "";

        const card = `
          <div class="movie-card ${hasReview ? "has-review" : ""}" id="card-${movieId}" ${hasReview ? `data-movie-id="${movieId}"` : ""}>
            ${reviewInd}
            <div class="movie-indicators">${seenInd}${theatreInd}</div>
            <img src="${displayPoster}" alt="${movie.title} Poster" class="movie-poster">
            <div class="movie-info">
              <h3 id="title-${movieId}">${displayTitle}</h3>
              <p><strong>Director:</strong> <span id="dir-${movieId}">${displayDir}</span></p>
            </div>
          </div>
        `;
        const modal = hasReview
          ? `
          <div class="movie-review-modal" id="${movieId}">
            <div class="modal-backdrop"></div>
            <div class="modal-content">
              <button class="modal-close">&times;</button>
              <img src="${displayPoster}" alt="${movie.title} Poster" class="modal-poster" id="modal-poster-${movieId}">
              <div class="modal-info">
                <h2 id="modal-title-${movieId}">${displayTitle}</h2>
                <p class="modal-meta"><strong>Director:</strong> <span id="modal-dir-${movieId}">${displayDir}</span></p>
                <div class="modal-review">
                  <h3>Notes</h3>
                  <p>${movie.review.replace(/\n/g, "<br>")}</p>
                </div>
              </div>
            </div>
          </div>
        `
          : "";
        return { card, modal, movie, movieId, hasCached: !!cd };
      });

      const cardsHtml = movieItems.map((m: any) => m.card).join("");
      const modalsHtml = movieItems.map((m: any) => m.modal).join("");

      // Background OMDB fetch for uncached movies only
      setTimeout(() => {
        movieItems.forEach(
          ({
            movie,
            movieId,
            hasCached,
          }: {
            movie: any;
            movieId: string;
            hasCached: boolean;
          }) => {
            if (hasCached) return;
            const cacheKey = movie.imdbID
              ? `movie_imdb_${movie.imdbID}`
              : `movie_title_${movie.title}_${movie.year}`;

            const updateMovieUI = (
              title: string,
              year: string,
              director: string,
              poster: string
            ) => {
              // Update card
              const titleEl = document.getElementById(`title-${movieId}`);
              if (titleEl) titleEl.textContent = `${title} (${year})`;
              const dirEl = document.getElementById(`dir-${movieId}`);
              if (dirEl) dirEl.textContent = director;
              const imgEl = document.querySelector(
                `#card-${movieId} .movie-poster`
              ) as HTMLImageElement;
              if (imgEl && poster) imgEl.src = poster;
              // Update modal
              const mTitle = document.getElementById(`modal-title-${movieId}`);
              if (mTitle) mTitle.textContent = `${title} (${year})`;
              const mDir = document.getElementById(`modal-dir-${movieId}`);
              if (mDir) mDir.textContent = director;
              const mImg = document.getElementById(
                `modal-poster-${movieId}`
              ) as HTMLImageElement;
              if (mImg && poster) mImg.src = poster;
              // Cache result
              localStorage.setItem(
                cacheKey,
                JSON.stringify({ title, year, director, poster })
              );
            };

            const omdbUrl = movie.imdbID
              ? `https://www.omdbapi.com/?i=${movie.imdbID}&apikey=${process.env.OMDB_API_KEY}`
              : `https://www.omdbapi.com/?t=${encodeURIComponent(movie.title)}&y=${movie.year}&apikey=${process.env.OMDB_API_KEY}`;

            fetch(omdbUrl)
              .then((r: Response) => r.json())
              .then((data: any) => {
                if (data.Response === "True" && data.Poster && data.Poster !== "N/A") {
                  const title = data.Title || movie.title;
                  const year = data.Year || movie.year;
                  const director = data.Director || "Unknown";
                  const poster = data.Poster;
                  updateMovieUI(title, year, director, poster);
                } else {
                  // Fallback to TMDB because OMDB failed or poster isn't available
                  fetchFromTMDB(movie.title, movie.year, movie.imdbID, movie.tmdbID, data.Director || "Unknown")
                    .then((tmdbData) => {
                      if (tmdbData) {
                        const title = tmdbData.title || (data.Response === "True" ? data.Title : movie.title);
                        const year = tmdbData.year || (data.Response === "True" ? data.Year : movie.year);
                        const director = tmdbData.director !== "Unknown" ? tmdbData.director : (data.Response === "True" && data.Director ? data.Director : "Unknown");
                        const poster = tmdbData.poster || (data.Response === "True" && data.Poster !== "N/A" ? data.Poster : "");
                        updateMovieUI(title, year, director, poster);
                      } else if (data.Response === "True") {
                        // fallback to OMDB even if no poster
                        updateMovieUI(data.Title || movie.title, data.Year || movie.year, data.Director || "Unknown", "");
                      } else {
                        const dirEl = document.getElementById(`dir-${movieId}`);
                        if (dirEl) dirEl.textContent = "Unknown";
                      }
                    });
                }
              })
              .catch(() => {
                // OMDB failed to fetch, fallback to TMDB
                fetchFromTMDB(movie.title, movie.year, movie.imdbID, movie.tmdbID)
                  .then((tmdbData) => {
                    if (tmdbData) {
                      updateMovieUI(tmdbData.title, tmdbData.year, tmdbData.director, tmdbData.poster);
                    } else {
                      const dirEl = document.getElementById(`dir-${movieId}`);
                      if (dirEl) dirEl.textContent = "Unknown";
                    }
                  });
              });
          },
        );
      }, 0);

      return `
        <h2 id="${section.title.toLowerCase().replace(/\s+/g, "-")}">${section.title}</h2>
        <div class="movie-grid">${cardsHtml}</div>
        ${modalsHtml}
      `;
    });

    // Add event listener setup for modals
    setTimeout(() => {
      // Move all modals to body for proper positioning
      document.querySelectorAll(".movie-review-modal").forEach((modal) => {
        document.body.appendChild(modal);
      });

      document.querySelectorAll(".movie-card.has-review").forEach((card) => {
        card.addEventListener("click", (e) => {
          e.stopPropagation();
          const movieId = card.getAttribute("data-movie-id");
          if (movieId) {
            const modal = document.getElementById(movieId);
            if (modal) {
              modal.classList.add("active");
              document.body.style.overflow = "hidden";
            }
          }
        });
      });

      document.querySelectorAll(".movie-review-modal").forEach((modal) => {
        const closeModal = () => {
          modal.classList.remove("active");
          document.body.style.overflow = "";
        };

        modal
          .querySelector(".modal-backdrop")
          ?.addEventListener("click", closeModal);
        modal
          .querySelector(".modal-close")
          ?.addEventListener("click", closeModal);

        // Close on Escape key
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && modal.classList.contains("active")) {
            closeModal();
          }
        });
      });
    }, 100);

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
          <div class="song-list-item" data-video-id="${song.videoId}" data-title="${song.title.replace(/"/g, "&quot;")}" data-artist="${song.artist.replace(/"/g, "&quot;")}" data-section-index="${sIndex}" data-song-index="${index}">
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
          ? `<button class="play-all-btn" data-section-index="${sIndex}"><span class="play-icon-small">▶</span> Play All</button>`
          : "";

      return `
        <div class="section-header">
          <div class="section-title-wrapper">
            <h2 id="${section.title.toLowerCase().replace(/\s+/g, "-")}">${section.title}</h2>
            <span class="playlist-length">${section.songs.length} songs</span>
          </div>
          ${playAllBtn}
        </div>
        <div class="song-list" data-section-index="${sIndex}">
          <div class="song-list-header-row">
            <div class="sl-col-index">#</div>
            <div class="sl-col-title">Title</div>
            <div class="sl-col-artist">Artist</div>
          </div>
          ${songListItems.join("")}
        </div>
      `;
    });

    // Add event listeners for songs
    setTimeout(() => {
      const player = MusicPlayerService.getInstance();

      // Handle "Play All"
      document.querySelectorAll(".play-all-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const sIndex = parseInt(
            btn.getAttribute("data-section-index") || "0",
          );
          const sectionTracks: Track[] = sections[sIndex].songs.map((s) => ({
            title: s.title,
            artist: s.artist,
            videoId: s.videoId,
          }));
          // Fisher-Yates shuffle
          for (let i = sectionTracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sectionTracks[i], sectionTracks[j]] = [sectionTracks[j], sectionTracks[i]];
          }
          player.playQueue(sectionTracks, 0);
        });
      });

      // Handle individual songs
      document.querySelectorAll(".song-list-item").forEach((item) => {
        item.addEventListener("click", () => {
          const sIndex = parseInt(
            item.getAttribute("data-section-index") || "0",
          );
          const songIndex = parseInt(
            item.getAttribute("data-song-index") || "0",
          );
          const sectionTracks: Track[] = sections[sIndex].songs.map((s) => ({
            title: s.title,
            artist: s.artist,
            videoId: s.videoId,
          }));
          player.playQueue(sectionTracks, songIndex);
        });
      });
    }, 100);

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
        <h2 id="${section.title.toLowerCase().replace(/\s+/g, "-")}">${section.title}</h2>
        <div class="paper-grid">${paperCards.join("")}</div>
      `;
    });

    return renderedSections.join("");
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

    // Stable hue from string hash
    const hashHue = (str: string) => {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
      return Math.abs(h) % 360;
    };

    const coverFor = (book: any) =>
      book.isbn ? `https://covers.openlibrary.org/b/isbn/${book.isbn}-M.jpg` : "";

    const spinesHtml = allBooks.map((book: any, i: number) => {
      const hue = hashHue(book.title);
      const widthRem = (2.7 + (book.title.length % 5) * 0.15).toFixed(2);
      const readBadge = book.isRead ? `<span class="shelf-book-read" title="Read">&check;</span>` : "";
      const cover = coverFor(book);
      const coverStyle = cover ? `--book-cover:url('${cover}');` : "";
      return `<div class="shelf-book" data-book-index="${i}" data-cover="${cover}" style="--book-hue:${hue};--book-width:${widthRem}rem;${coverStyle}" title="${book.title.replace(/"/g, '&quot;')}">
  <div class="shelf-book-spine"><span class="shelf-book-label">${book.title}</span>${readBadge}</div>
</div>`;
    }).join("\n");

    const booksJson = JSON.stringify(
      allBooks.map((b: any) => ({ ...b, cover: coverFor(b) })),
    ).replace(/</g, "\\u003c");

    return `
<div class="bookshelf-scene">
  <div class="bookshelf-stage">
    <button class="shelf-arrow shelf-arrow--prev" id="shelf-arrow-prev" aria-label="Previous books" disabled>&#8249;</button>
    <div class="bookshelf-row">
      <div class="shelf-track" id="shelf-track">${spinesHtml}</div>
      <div class="shelf-plank"></div>
    </div>
    <button class="shelf-arrow shelf-arrow--next" id="shelf-arrow-next" aria-label="Next books" disabled>&#8250;</button>
  </div>
  <p class="shelf-hint">click a book to read notes</p>
</div>
<div class="shelf-modal" id="shelf-modal" role="dialog" aria-modal="true">
  <div class="shelf-modal-backdrop" id="shelf-modal-backdrop"></div>
  <div class="shelf-modal-box">
    <button class="shelf-modal-close" id="shelf-modal-close" aria-label="Close">&#10005;</button>
    <div class="shelf-panel-layout">
      <img class="shelf-panel-cover" id="shelf-panel-cover" alt="" hidden>
      <div class="shelf-panel-body">
        <h2 class="shelf-panel-title" id="shelf-panel-title"></h2>
        <div class="shelf-panel-meta" id="shelf-panel-meta"></div>
        <hr class="shelf-modal-divider">
        <div class="shelf-panel-review" id="shelf-panel-review"></div>
      </div>
    </div>
  </div>
</div>
<script type="application/json" id="shelf-books-data">${booksJson}</script>`;
  }

  private setupBookshelfInteractivity(): void {
    const track = document.getElementById("shelf-track");
    const modal = document.getElementById("shelf-modal");
    const backdrop = document.getElementById("shelf-modal-backdrop");
    const closeBtn = document.getElementById("shelf-modal-close");
    const panelTitle = document.getElementById("shelf-panel-title");
    const panelMeta = document.getElementById("shelf-panel-meta");
    const panelReview = document.getElementById("shelf-panel-review");
    const dataEl = document.getElementById("shelf-books-data");
    if (!track || !modal || !dataEl) return;

    // Move modal to body so it overlays everything
    document.body.appendChild(modal);

    let booksData: any[] = [];
    try { booksData = JSON.parse(dataEl.textContent || "[]"); } catch (_) { return; }

    // Reveal the cover art on the binding as soon as the image is available;
    // until then the spine keeps its solid colour as a graceful fallback.
    const applyCover = (el: HTMLElement, cover: string) => {
      const img = new Image();
      img.onload = () => {
        el.classList.add("has-cover");
        el.style.setProperty("--book-cover", `url('${cover}')`);
      };
      img.src = cover;
    };

    track.querySelectorAll<HTMLElement>(".shelf-book").forEach((bookEl) => {
      const cover = bookEl.dataset.cover;
      if (cover) applyCover(bookEl, cover);
    });

    // Books without an ISBN get no cover URL; look the cover up by title in the
    // background so the shelf still ends up with real binding art. If the
    // background cover prefetch already resolved this title, reuse its result.
    booksData.forEach((book, idx) => {
      if (book.cover) return;
      const cachedCover = localStorage.getItem(`book_cover_${book.title}`);
      if (cachedCover) {
        book.cover = cachedCover;
        const el = track.querySelector(`.shelf-book[data-book-index="${idx}"]`) as HTMLElement | null;
        if (el) {
          el.dataset.cover = cachedCover;
          applyCover(el, cachedCover);
        }
        return;
      }
      fetch(`https://openlibrary.org/search.json?q=intitle:${encodeURIComponent(book.title)}`)
        .then((r) => r.json())
        .then((data: any) => {
          const info = data && data.docs && data.docs[0];
          if (!info || !info.cover_i) return;
          const cover = `https://covers.openlibrary.org/b/id/${info.cover_i}-M.jpg`;
          book.cover = cover;
          const el = track.querySelector(`.shelf-book[data-book-index="${idx}"]`) as HTMLElement | null;
          if (el) {
            el.dataset.cover = cover;
            applyCover(el, cover);
          }
        })
        .catch(() => {});
    });

    // drag-to-scroll (native touch scrolling also works)
    let isDragging = false, startX = 0, scrollStart = 0, didDrag = false;
    track.addEventListener("mousedown", (e) => {
      isDragging = true; didDrag = false;
      startX = (e as MouseEvent).clientX; scrollStart = track.scrollLeft;
      track.style.cursor = "grabbing";
      track.style.scrollBehavior = "auto"; // keep dragging direct, not smoothed
    });
    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = (e as MouseEvent).clientX - startX;
      if (Math.abs(dx) > 4) didDrag = true;
      track.scrollLeft = scrollStart - dx;
    });
    window.addEventListener("mouseup", () => { isDragging = false; track.style.cursor = "grab"; track.style.scrollBehavior = ""; });

    let tStartX = 0, tScroll = 0;
    track.addEventListener("touchstart", (e) => { tStartX = (e as TouchEvent).touches[0].clientX; tScroll = track.scrollLeft; track.style.scrollBehavior = "auto"; }, { passive: true });
    track.addEventListener("touchmove", (e) => { track.scrollLeft = tScroll - ((e as TouchEvent).touches[0].clientX - tStartX); }, { passive: true });
    track.addEventListener("touchend", () => { track.style.scrollBehavior = ""; }, { passive: true });

    // Centre the row when few books fit so the shelf doesn't look empty
    const shelfFits = () => track.scrollWidth <= track.clientWidth + 1;
    const syncFitClass = () => track.classList.toggle("shelf-fits", shelfFits());
    syncFitClass();
    window.addEventListener("resize", syncFitClass);

    // ── Arrow navigation ────────────────────────────────────
    // Side chevrons scroll the shelf by a page, work with touch taps, and
    // disable themselves when there is nothing to scroll on that side.
    const prevBtn = document.getElementById("shelf-arrow-prev") as HTMLButtonElement | null;
    const nextBtn = document.getElementById("shelf-arrow-next") as HTMLButtonElement | null;

    const syncArrows = () => {
      const maxScroll = track.scrollWidth - track.clientWidth;
      if (prevBtn) prevBtn.disabled = track.scrollLeft <= 1;
      if (nextBtn) nextBtn.disabled = maxScroll - track.scrollLeft <= 1;
    };
    syncArrows();
    track.addEventListener("scroll", syncArrows, { passive: true });
    window.addEventListener("resize", syncArrows);

    const scrollByArrow = (dir: number) => {
      const step = Math.max(track.clientWidth * 0.75, 120);
      track.scrollBy({ left: dir * step, behavior: "smooth" });
    };
    prevBtn?.addEventListener("click", () => scrollByArrow(-1));
    nextBtn?.addEventListener("click", () => scrollByArrow(1));

    let activeBook: HTMLElement | null = null;

    const closeModal = () => {
      modal.classList.remove("shelf-modal--open");
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
      if (activeBook) { activeBook.classList.remove("shelf-book--active"); activeBook = null; }
    };

    track.querySelectorAll<HTMLElement>(".shelf-book").forEach((bookEl) => {
      bookEl.addEventListener("click", () => {
        if (didDrag) { didDrag = false; return; }
        const idx = parseInt(bookEl.dataset.bookIndex || "0", 10);
        // Toggle off if already selected
        if (bookEl.classList.contains("shelf-book--active")) { closeModal(); return; }
        if (activeBook) activeBook.classList.remove("shelf-book--active");
        activeBook = bookEl;
        bookEl.classList.add("shelf-book--active");

        const book = booksData[idx];
        if (!book) return;

        if (panelTitle) panelTitle.textContent = book.title;
        if (panelMeta) panelMeta.innerHTML = book.isRead
          ? '<span class="shelf-badge-read">&#10003; Read</span>'
          : '<span class="shelf-badge-unread">To Read</span>';
        if (panelReview) panelReview.innerHTML = book.review
          ? book.review.replace(/\n/g, "<br>")
          : '<em style="opacity:0.5">No notes yet.</em>';

        const coverEl = document.getElementById("shelf-panel-cover") as HTMLImageElement | null;
        if (coverEl) {
          if (book.cover) {
            coverEl.src = book.cover;
            coverEl.hidden = false;
          } else {
            coverEl.hidden = true;
          }
        }

        // Compensate for the scrollbar disappearing so the page doesn't jump
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = "hidden";
        if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
        modal.classList.add("shelf-modal--open");
      });
    });

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (backdrop) backdrop.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  }
}
