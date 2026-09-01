import { PhotoItem } from "../types/photo";
import { Y2KAudioController } from "../services/y2k-audio";

export class Carousel {
  private photos: PhotoItem[];
  private currentIndex: number = 0;
  private container: HTMLElement | null = null;
  private autoPlayTimer: number | null = null;
  private touchStartX: number = 0;
  private touchEndX: number = 0;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(photos: PhotoItem[]) {
    this.photos = photos;
  }

  public render(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("carousel-wrapper");
    this.container = wrapper;

    if (this.photos.length === 0) {
      wrapper.innerHTML = `<div class="carousel-empty">No photos to display yet.</div>`;
      return wrapper;
    }

    const hasMultiple = this.photos.length > 1;

    wrapper.innerHTML = `
      <div class="carousel-container" tabindex="0" aria-label="Photo carousel">
        <div class="carousel-stage">
          <div class="carousel-track">
            ${this.photos
              .map(
                (photo, idx) => `
              <div class="carousel-slide ${idx === 0 ? "active" : ""}" data-index="${idx}">
                <div class="carousel-image-card">
                  <img
                    src="${photo.src}"
                    alt="${photo.alt || "Photo"}"
                    class="carousel-img"
                    loading="${idx === 0 ? "eager" : "lazy"}"
                    decoding="async"
                    fetchpriority="${idx === 0 ? "high" : "low"}"
                  />
                  <div class="carousel-expand-hint" title="Click to view full image">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                    </svg>
                  </div>
                </div>
              </div>
            `
              )
              .join("")}
          </div>

          ${
            hasMultiple
              ? `
            <button class="carousel-btn carousel-btn-prev" aria-label="Previous photo">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>
            <button class="carousel-btn carousel-btn-next" aria-label="Next photo">
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          `
              : ""
          }
        </div>

        <div class="carousel-footer">
          <div class="carousel-counter">
            <span class="carousel-current">${String(this.currentIndex + 1).padStart(2, "0")}</span>
            <span class="carousel-separator">/</span>
            <span class="carousel-total">${String(this.photos.length).padStart(2, "0")}</span>
          </div>

          ${
            hasMultiple
              ? `
            <div class="carousel-indicators">
              ${this.photos
                .map(
                  (_, idx) => `
                <button class="carousel-dot ${idx === 0 ? "active" : ""}" data-index="${idx}" aria-label="Go to photo ${idx + 1}"></button>
              `
                )
                .join("")}
            </div>
          `
              : ""
          }
        </div>
      </div>

      <!-- Fullscreen Lightbox Modal -->
      <div class="carousel-lightbox" aria-hidden="true">
        <div class="carousel-lightbox-backdrop"></div>
        <div class="carousel-lightbox-content">
          <button class="carousel-lightbox-close" aria-label="Close full view">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <img class="carousel-lightbox-img" src="" alt="" />
        </div>
      </div>
    `;

    this.attachEventListeners(wrapper);
    if (hasMultiple) {
      this.startAutoPlay();
    }

    return wrapper;
  }

  private attachEventListeners(wrapper: HTMLElement): void {
    const prevBtn = wrapper.querySelector(".carousel-btn-prev");
    const nextBtn = wrapper.querySelector(".carousel-btn-next");
    const dots = wrapper.querySelectorAll(".carousel-dot");
    const slides = wrapper.querySelectorAll(".carousel-slide");
    const lightbox = wrapper.querySelector(".carousel-lightbox") as HTMLElement;
    const lightboxClose = wrapper.querySelector(".carousel-lightbox-close");
    const lightboxBackdrop = wrapper.querySelector(".carousel-lightbox-backdrop");

    prevBtn?.addEventListener("click", () => {
      this.stopAutoPlay();
      this.prev();
    });

    nextBtn?.addEventListener("click", () => {
      this.stopAutoPlay();
      this.next();
    });

    dots.forEach((dot) => {
      dot.addEventListener("click", (e) => {
        this.stopAutoPlay();
        const target = e.currentTarget as HTMLElement;
        const index = parseInt(target.getAttribute("data-index") || "0", 10);
        this.goTo(index);
      });
    });

    // Lightbox triggers on image click
    slides.forEach((slide) => {
      const card = slide.querySelector(".carousel-image-card");
      card?.addEventListener("click", () => {
        const idx = parseInt(slide.getAttribute("data-index") || "0", 10);
        this.openLightbox(idx);
      });
    });

    lightboxClose?.addEventListener("click", () => this.closeLightbox());
    lightboxBackdrop?.addEventListener("click", () => this.closeLightbox());

    // Swipe & Touch Support
    const stage = wrapper.querySelector(".carousel-stage");
    stage?.addEventListener(
      "touchstart",
      (e: Event) => {
        const touchEvent = e as TouchEvent;
        this.touchStartX = touchEvent.changedTouches[0].screenX;
        this.stopAutoPlay();
      },
      { passive: true }
    );

    stage?.addEventListener(
      "touchend",
      (e: Event) => {
        const touchEvent = e as TouchEvent;
        this.touchEndX = touchEvent.changedTouches[0].screenX;
        this.handleSwipe();
      },
      { passive: true }
    );

    // Keyboard navigation
    this.keydownHandler = (e: KeyboardEvent) => {
      if (lightbox && lightbox.classList.contains("open")) {
        if (e.key === "Escape") {
          this.closeLightbox();
        } else if (e.key === "ArrowLeft") {
          this.prev();
          this.updateLightboxContent();
        } else if (e.key === "ArrowRight") {
          this.next();
          this.updateLightboxContent();
        }
        return;
      }

      // Check if user is typing in input
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return;
      }

      if (e.key === "ArrowLeft") {
        this.stopAutoPlay();
        this.prev();
      } else if (e.key === "ArrowRight") {
        this.stopAutoPlay();
        this.next();
      }
    };

    window.addEventListener("keydown", this.keydownHandler);

    // Pause autoplay on mouse enter
    stage?.addEventListener("mouseenter", () => this.stopAutoPlay());
    stage?.addEventListener("mouseleave", () => {
      if (this.photos.length > 1) this.startAutoPlay();
    });

    // Pause autoplay if tab is in background
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private visibilityHandler = (): void => {
    if (document.hidden) {
      this.stopAutoPlay();
    } else if (this.photos.length > 1) {
      this.startAutoPlay();
    }
  };

  private handleSwipe(): void {
    const diff = this.touchStartX - this.touchEndX;
    if (Math.abs(diff) > 45) {
      if (diff > 0) {
        this.next();
      } else {
        this.prev();
      }
    }
  }

  public next(): void {
    if (this.photos.length <= 1) return;
    if (document.body.dataset.theme === "y2k-cyber") {
      Y2KAudioController.playSlide();
    }
    const newIndex = (this.currentIndex + 1) % this.photos.length;
    this.goTo(newIndex);
  }

  public prev(): void {
    if (this.photos.length <= 1) return;
    if (document.body.dataset.theme === "y2k-cyber") {
      Y2KAudioController.playSlide();
    }
    const newIndex = (this.currentIndex - 1 + this.photos.length) % this.photos.length;
    this.goTo(newIndex);
  }

  public goTo(index: number): void {
    if (index === this.currentIndex || !this.container) return;
    this.currentIndex = index;

    const slides = this.container.querySelectorAll(".carousel-slide");
    slides.forEach((slide, idx) => {
      slide.classList.toggle("active", idx === this.currentIndex);
    });

    const dots = this.container.querySelectorAll(".carousel-dot");
    dots.forEach((dot, idx) => {
      dot.classList.toggle("active", idx === this.currentIndex);
    });

    const currentCounter = this.container.querySelector(".carousel-current");
    if (currentCounter) {
      currentCounter.textContent = String(this.currentIndex + 1).padStart(2, "0");
    }
  }

  private openLightbox(index: number): void {
    if (!this.container) return;
    this.currentIndex = index;
    const lightbox = this.container.querySelector(".carousel-lightbox") as HTMLElement;
    if (lightbox) {
      lightbox.classList.add("open");
      lightbox.setAttribute("aria-hidden", "false");
      this.updateLightboxContent();
      document.body.style.overflow = "hidden";
    }
  }

  private updateLightboxContent(): void {
    if (!this.container) return;
    const lightbox = this.container.querySelector(".carousel-lightbox") as HTMLElement;
    if (!lightbox) return;

    const currentPhoto = this.photos[this.currentIndex];
    const img = lightbox.querySelector(".carousel-lightbox-img") as HTMLImageElement;

    if (img && currentPhoto) {
      img.src = currentPhoto.src;
      img.alt = currentPhoto.alt || "Photo";
    }
  }

  private closeLightbox(): void {
    if (!this.container) return;
    const lightbox = this.container.querySelector(".carousel-lightbox") as HTMLElement;
    if (lightbox) {
      lightbox.classList.remove("open");
      lightbox.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
  }

  private startAutoPlay(): void {
    if (this.autoPlayTimer) clearInterval(this.autoPlayTimer);
    this.autoPlayTimer = window.setInterval(() => {
      this.next();
    }, 4000);
  }

  private stopAutoPlay(): void {
    if (this.autoPlayTimer) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
  }

  public destroy(): void {
    this.stopAutoPlay();
    document.removeEventListener("visibilitychange", this.visibilityHandler);
    if (this.keydownHandler) {
      window.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
    document.body.style.overflow = "";
  }
}
