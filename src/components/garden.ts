/**
 * The homepage garden.
 *
 * A clock of every minute spent on this site (all sessions, straight out of
 * localStorage) and, around it, the garden those minutes grow: each flower
 * opens on its own schedule and none of them ever wilt. Every plant keeps a
 * seed marker in the soil — hover or tap one to see the stages still ahead
 * of it.
 */

import {
  FLOWERS,
  FLOWER_STAGES,
  GardenService,
  flowerProgress,
  formatClock,
  formatSpan,
  secondsUntilBloom,
  stageOf,
  type FlowerSpecies,
} from "../services/garden";
import {
  flowerSvg,
  grassMarkup,
  hashUnit,
  sceneDefsMarkup,
  seedMarkerSvg,
  soilLipMarkup,
  soilMarkup,
  sunMarkup,
  type Placement,
} from "./flower-svg";

const SCENE_WIDTH = 900;
const SCENE_HEIGHT = 300;
const BACK_BASE_Y = 256;
const FRONT_BASE_Y = 288;
const SOIL_TOP_Y = 250;
const SOIL_LIP_Y = 286;
const SEED_Y_BACK = SOIL_TOP_Y + 3;
const SEED_Y_FRONT = SOIL_LIP_Y - 3;
/** How long a freshly opened flower keeps its glow. */
const FRESH_SECONDS = 180;
/**
 * The scene is redrawn this often at most. Growth is slow enough that a few
 * seconds between redraws is invisible, and it keeps the whole bed cheap on
 * a phone (a stage change always redraws immediately).
 */
const SCENE_REBUILD_MS = 3000;
/** Stages listed in a seed's card. */
const ROADMAP_ROWS = 4;

type BedPosition = Placement & {
  species: FlowerSpecies;
  back: boolean;
  seedY: number;
};

/** Fixed planting plan: two staggered rows, deterministic jitter per flower. */
function planBed(): BedPosition[] {
  const count = FLOWERS.length;
  return FLOWERS.map((species, index) => {
    const back = index % 2 === 1;
    const slot = (index + 0.5) / count;
    const x =
      44 + slot * (SCENE_WIDTH - 88) + (hashUnit(`${species.id}-x`) - 0.5) * 42;
    const baseY =
      (back ? BACK_BASE_Y : FRONT_BASE_Y) + (hashUnit(`${species.id}-y`) - 0.5) * 6;
    const scale = (back ? 0.82 : 1) * (0.95 + hashUnit(`${species.id}-scale`) * 0.1);
    const seedY = (back ? SEED_Y_BACK : SEED_Y_FRONT) + (hashUnit(`${species.id}-sy`) - 0.5) * 3;
    return { species, x, baseY, scale, back, seedY };
  });
}

/** Only one panel lives at a time, even if the homepage re-renders. */
let activePanel: GardenPanel | null = null;

export class GardenPanel {
  private el: HTMLElement | null = null;
  private stageEl: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private sessionEl: HTMLElement | null = null;
  private bloomedEl: HTMLElement | null = null;
  private plantedEl: HTMLElement | null = null;
  private sceneEl: HTMLElement | null = null;
  private captionEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private nextLabelEl: HTMLElement | null = null;
  private barFillEl: HTMLElement | null = null;
  private actionsEl: HTMLElement | null = null;

  private bed = planBed();
  /** Plant whose card is open, and whether the visitor pinned it (tap). */
  private focused: string | null = null;
  private pinned = false;
  private hideTimer: number | null = null;
  private sceneKey = "";
  private sceneBuiltAt = 0;
  /** What the open card is currently showing, so it isn't rebuilt per tick. */
  private cardKey = "";
  private confirmingReset = false;
  private canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  private unsubscribe: (() => void) | null = null;

  render(): HTMLElement {
    const service = GardenService.getInstance();
    service.init();
    if (activePanel && activePanel !== this) activePanel.destroy();

    const el = document.createElement("section");
    el.className = "garden";
    el.innerHTML = `
      <header class="garden-head">
        <div class="garden-headline">
          <div class="garden-kicker">the garden &mdash; time spent here</div>
          <div class="garden-clock" id="garden-clock">0m 00s</div>
          <div class="garden-meta">
            <span id="garden-session">counting from this second</span>
            <span class="garden-meta-sep">&middot;</span>
            <span id="garden-bloomed">0 of ${FLOWERS.length} in bloom</span>
            <span class="garden-meta-sep">&middot;</span>
            <span id="garden-planted"></span>
          </div>
        </div>
        <div class="garden-next">
          <div class="garden-next-label" id="garden-next-label"></div>
          <div class="garden-bar"><span class="garden-bar-fill" id="garden-bar-fill"></span></div>
          <div class="garden-actions" id="garden-actions"></div>
        </div>
      </header>
      <div class="garden-stage" id="garden-stage">
        <div class="garden-caption" id="garden-caption"></div>
        <div class="garden-scene" id="garden-scene"></div>
        <div class="garden-card" id="garden-card"></div>
      </div>
    `;

    this.el = el;
    this.stageEl = el.querySelector("#garden-stage");
    this.clockEl = el.querySelector("#garden-clock");
    this.sessionEl = el.querySelector("#garden-session");
    this.bloomedEl = el.querySelector("#garden-bloomed");
    this.plantedEl = el.querySelector("#garden-planted");
    this.sceneEl = el.querySelector("#garden-scene");
    this.captionEl = el.querySelector("#garden-caption");
    this.cardEl = el.querySelector("#garden-card");
    this.nextLabelEl = el.querySelector("#garden-next-label");
    this.barFillEl = el.querySelector("#garden-bar-fill");
    this.actionsEl = el.querySelector("#garden-actions");

    this.renderActions();
    this.wirePointer();
    this.actionsEl?.addEventListener("click", this.handleActionClick);
    this.update();

    this.unsubscribe = service.onChange(this.update);
    activePanel = this;

    return el;
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    document.removeEventListener("pointerdown", this.handleOutsidePointerDown);
    window.removeEventListener("resize", this.handleResize);
    if (activePanel === this) activePanel = null;
  }

  // ── Building blocks ─────────────────────────────────────────────

  private renderActions(): void {
    if (!this.actionsEl) return;
    const service = GardenService.getInstance();
    if (!this.confirmingReset) {
      this.actionsEl.innerHTML =
        `<button type="button" class="garden-reset" data-action="ask">reset the garden</button>`;
      return;
    }
    this.actionsEl.innerHTML =
      `<span class="garden-confirm">clear ${formatClock(service.getTotalSeconds())} of time?</span>` +
      `<button type="button" class="garden-reset garden-reset-yes" data-action="confirm">yes, clear</button>` +
      `<button type="button" class="garden-reset garden-reset-no" data-action="cancel">keep it</button>`;
  }

  private sceneMarkup(total: number): string {
    const back: string[] = [];
    const front: string[] = [];
    const seeds: string[] = [];

    for (const place of this.bed) {
      const progress = flowerProgress(place.species, total);
      const bloomed = total >= place.species.bloomSeconds;
      (place.back ? back : front).push(
        flowerSvg(place.species, progress, place, bloomed)
      );
      // Seed markers sit on top of the soil so the front row's stay visible.
      seeds.push(seedMarkerSvg(place.species, place.x, place.seedY, bloomed));
    }

    return (
      `<svg class="garden-svg" viewBox="0 0 ${SCENE_WIDTH} ${SCENE_HEIGHT}" ` +
      `preserveAspectRatio="xMidYMax meet" role="img" ` +
      `aria-label="A garden that grows with every minute spent here">` +
      sceneDefsMarkup(FLOWERS) +
      sunMarkup(SCENE_WIDTH, SCENE_HEIGHT) +
      grassMarkup(SCENE_WIDTH, SOIL_TOP_Y - 4) +
      back.join("") +
      soilMarkup(SCENE_WIDTH, SOIL_TOP_Y) +
      front.join("") +
      soilLipMarkup(SCENE_WIDTH, SOIL_LIP_Y) +
      seeds.join("") +
      `</svg>`
    );
  }

  // ── Live updates ────────────────────────────────────────────────

  private update = (): void => {
    if (!this.el) return;
    const total = GardenService.getInstance().getTotalSeconds();

    if (this.clockEl) this.clockEl.textContent = formatClock(total);
    if (this.sessionEl) {
      const session = GardenService.getInstance().getSessionSeconds();
      this.sessionEl.textContent =
        session >= 1 ? `this visit ${formatClock(session)}` : "counting from this second";
    }

    const open = this.bed.filter((p) => total >= p.species.bloomSeconds).length;
    if (this.bloomedEl) this.bloomedEl.textContent = `${open} of ${FLOWERS.length} in bloom`;
    if (this.plantedEl) {
      const startedAt = GardenService.getInstance().getStartedAt();
      this.plantedEl.textContent = startedAt
        ? `planted ${new Date(startedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}`
        : "planted today";
    }

    this.updateNext(total);
    this.updateScene(total);
    if (this.focused) this.showCard(this.focused);
    else this.showCaption(this.nextFlower(total));
  };

  private updateNext(total: number): void {
    const next = this.nextFlower(total);
    if (!this.nextLabelEl || !this.barFillEl) return;

    if (!next) {
      this.nextLabelEl.innerHTML = `<span class="garden-next-key">full</span> every flower is open`;
      this.barFillEl.style.width = "100%";
      return;
    }
    const progress = flowerProgress(next.species, total);
    this.nextLabelEl.innerHTML =
      `<span class="garden-next-key">next</span> ${next.species.name}` +
      `<span class="garden-next-eta">${formatSpan(secondsUntilBloom(next.species, total))} to bloom</span>`;
    this.barFillEl.style.width = `${Math.max(1.5, progress * 100).toFixed(2)}%`;
    this.barFillEl.style.background = `var(${next.species.petalVar})`;
  }

  private updateScene(total: number): void {
    if (!this.sceneEl) return;
    // Redraw on a stage change right away; otherwise on a slow clock, so the
    // bed isn't rebuilt on every ticking second.
    const key = this.bed
      .map((p) => {
        const progress = flowerProgress(p.species, total);
        return `${stageOf(progress).label}${progress >= 1 ? "+" : ""}`;
      })
      .join("|");
    const now = performance.now();
    if (key !== this.sceneKey || now - this.sceneBuiltAt >= SCENE_REBUILD_MS) {
      this.sceneKey = key;
      this.sceneBuiltAt = now;
      this.sceneEl.innerHTML = this.sceneMarkup(total);
    }

    const nextId = this.nextFlower(total)?.species.id ?? null;
    for (const place of this.bed) {
      const id = place.species.id;
      const lit = this.focused === id;
      const age = total - place.species.bloomSeconds;
      this.sceneEl
        .querySelectorAll<SVGElement>(`[data-flower="${id}"]`)
        .forEach((node) => {
          node.classList.toggle("is-hovered", lit);
          if (node.classList.contains("garden-flower")) {
            node.classList.toggle("is-fresh", age >= 0 && age < FRESH_SECONDS);
          }
          // The seed that opens next breathes a little: it is the invitation.
          if (node.classList.contains("garden-seed")) {
            node.classList.toggle("is-next", id === nextId);
          }
        });
    }
  }

  private nextFlower(total: number): BedPosition | null {
    return this.bed.find((p) => total < p.species.bloomSeconds) ?? null;
  }

  // ── Seeds: hover, tap, and the card they open ───────────────────

  private wirePointer(): void {
    if (!this.el) return;

    this.el.addEventListener("pointerover", (event) => {
      const node = (event.target as Element | null)?.closest<SVGElement>("[data-flower]");
      const id = node?.getAttribute("data-flower") ?? null;
      if (!id || id === this.focused) return;
      if (this.hideTimer !== null) {
        window.clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      this.focused = id;
      this.pinned = false;
      this.update();
    });

    this.el.addEventListener("pointerleave", () => {
      if (this.pinned) return;
      this.scheduleHide();
    });

    // Tap support: tapping a seed (or its plant) pins the card so phones get
    // the same information as hover does.
    this.el.addEventListener("click", (event) => {
      const node = (event.target as Element | null)?.closest<SVGElement>("[data-flower]");
      const id = node?.getAttribute("data-flower") ?? null;
      if (!id) return;
      if (this.pinned && this.focused === id) {
        this.unfocus();
        return;
      }
      this.focused = id;
      this.pinned = true;
      this.update();
    });

    // A tap anywhere else puts the card away, and a resize re-anchors the card
    // to its seed (the seed's own position is redrawn, the card is not).
    document.addEventListener("pointerdown", this.handleOutsidePointerDown);
    window.addEventListener("resize", this.handleResize);
  }

  private handleResize = (): void => {
    if (!this.focused || !this.sceneEl) return;
    const seed = this.sceneEl.querySelector<SVGGElement>(
      `.garden-seed[data-flower="${this.focused}"]`
    );
    if (seed) this.positionCard(seed);
  };

  private handleOutsidePointerDown = (event: PointerEvent): void => {
    if (!this.pinned || !this.el) return;
    if (this.el.contains(event.target as Node)) return;
    this.unfocus();
  };

  private scheduleHide(): void {
    if (this.hideTimer !== null) window.clearTimeout(this.hideTimer);
    // Short delay so travelling from a seed to a neighbouring plant (or over
    // the card's own corner) doesn't blink the card out.
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = null;
      this.focused = null;
      this.update();
    }, 140);
  }

  private unfocus(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.pinned = false;
    this.focused = null;
    this.update();
  }

  /**
   * The stages still ahead of a plant, each stamped with the reading time at
   * which it arrives ("at 3h") rather than a countdown — the running clock
   * already sits at the top of the panel, and a stamp holds still instead of
   * ticking, so the card only redraws when the plant actually changes stage.
   */
  private roadmap(species: FlowerSpecies, total: number): { label: string; at: string }[] {
    const progress = flowerProgress(species, total);
    return FLOWER_STAGES.filter((stage) => stage.at > progress)
      .slice(0, ROADMAP_ROWS)
      .map((stage) => ({
        label: stage.label,
        at: formatSpan(stage.at * species.bloomSeconds),
      }));
  }

  private showCard(id: string): void {
    if (!this.cardEl || !this.stageEl || !this.sceneEl) return;
    const place = this.bed.find((p) => p.species.id === id);
    const seed = this.sceneEl.querySelector<SVGGElement>(
      `.garden-seed[data-flower="${id}"]`
    );
    if (!place || !seed) return;

    const service = GardenService.getInstance();
    const total = service.getTotalSeconds();
    const species = place.species;
    const progress = flowerProgress(species, total);
    const bloomed = progress >= 1;
    const stage = stageOf(progress);
    const roadmap = this.roadmap(species, total);
    const remaining = FLOWER_STAGES.filter((s) => s.at > progress).length;

    const stateLine = bloomed
      ? `in full bloom &middot; opened at ${formatSpan(species.bloomSeconds)}`
      : `${stage.label.toLowerCase()} &middot; in full bloom at ${formatSpan(
          species.bloomSeconds
        )}`;

    // Everything on the card is now a fixed stamp, so it only needs rebuilding
    // when the plant changes stage — not on every tick of the clock.
    const cardKey = `${id}|${stage.label}|${bloomed ? "open" : "growing"}`;
    if (cardKey !== this.cardKey) {
      this.cardKey = cardKey;
      this.fillCard(species, bloomed, stateLine, roadmap, remaining);
      this.positionCard(seed);
    }
    this.cardEl.classList.add("is-visible");
  }

  private fillCard(
    species: FlowerSpecies,
    bloomed: boolean,
    stateLine: string,
    roadmap: { label: string; at: string }[],
    remaining: number
  ): void {
    if (!this.cardEl) return;
    this.cardEl.innerHTML =
      `<div class="garden-card-head">` +
      `<span class="garden-card-dot" style="background:var(${species.petalVar}); color:var(${species.petalVar})"></span>` +
      `<span class="garden-card-name">${species.name}</span>` +
      `</div>` +
      `<div class="garden-card-state">${stateLine}</div>` +
      (bloomed
        ? `<div class="garden-card-note">Every stage complete \u2014 nothing left to wait for.</div>`
        : `<ul class="garden-card-stages">` +
          roadmap
            .map(
              (row) =>
                `<li><span>${row.label}</span><span>at ${row.at}</span></li>`
            )
            .join("") +
          (remaining > roadmap.length
            ? `<li class="garden-card-more"><span>+${remaining - roadmap.length} more stage${
                remaining - roadmap.length === 1 ? "" : "s"
              }</span></li>`
            : "") +
          `</ul>`) +
      `<div class="garden-card-whisper">${species.whisper}</div>`;
  }

  /** Park the card above its seed, flipping below when it would run off. */
  private positionCard(seed: SVGElement): void {
    if (!this.cardEl || !this.stageEl) return;
    const card = this.cardEl;
    const stageRect = this.stageEl.getBoundingClientRect();
    const seedRect = seed.getBoundingClientRect();
    const width = card.offsetWidth;
    const height = card.offsetHeight;

    let left = seedRect.left + seedRect.width / 2 - stageRect.left;
    left = Math.min(Math.max(left, width / 2 + 4), stageRect.width - width / 2 - 4);

    let below = false;
    let top = seedRect.top - stageRect.top - 9;
    if (top - height < 2) {
      below = true;
      top = seedRect.bottom - stageRect.top + 9;
    }

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.transform = below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
    card.classList.toggle("is-below", below);
    const arrow = seedRect.left + seedRect.width / 2 - (left - width / 2);
    card.style.setProperty("--garden-arrow", `${Math.round(arrow)}px`);
  }

  private showCaption(place: BedPosition | null): void {
    if (!this.captionEl) return;
    if (this.cardEl) this.cardEl.classList.remove("is-visible");
    if (!place) {
      this.captionEl.innerHTML =
        `<span class="garden-caption-whisper">Every flower that was planted here has opened.</span>`;
      return;
    }
    this.captionEl.innerHTML =
      `<span class="garden-caption-hint">${
        this.canHover ? "hover a seed" : "tap a seed"
      } to see what it becomes</span>`;
  }

  // ── Reset ───────────────────────────────────────────────────────

  private handleActionClick = (event: MouseEvent): void => {
    const button = (event.target as Element | null)?.closest<HTMLElement>("[data-action]");
    if (!button) return;
    const action = button.getAttribute("data-action");
    if (action === "ask") {
      this.confirmingReset = true;
      this.renderActions();
      return;
    }
    if (action === "confirm") {
      GardenService.getInstance().reset();
      this.unfocus();
    }
    this.confirmingReset = false;
    this.renderActions();
    this.update();
  };
}
