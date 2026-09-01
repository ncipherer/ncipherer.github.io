/**
 * The projector.
 *
 * `screens.md` renders as a rack of reels: one projector per section, a
 * vertical reel of frames beneath it — a row per film, lit while it is the one
 * on the wall — and a wall the loaded frame is thrown onto. The machine is
 * deliberately plain — a body, two reels, a gate — because the picture on the
 * wall is the only thing here worth looking at.
 *
 * The film runs the way film does: up from the rack, through the gate, and out
 * to the take-up reel. Only the frame in the gate is inside the machine — the
 * face is cut away at the aperture, and the film passes behind it — so the
 * frame before it and the frame after it sit outside the box, on the film
 * hanging out of the slots: one just gone through, one still to come. Changing
 * the film winds the reels and travels the film exactly one frame, so the
 * neighbour above drops out of the machine and the one below rolls in.
 *
 * This module owns everything that happens after that markup lands: the wind,
 * the wall, the rack, keyboard and touch navigation, keeping the projection in
 * step when a review is skimmed from inside the modal, and remembering the film
 * that was on the wall before the notes were opened — so closing the overlay
 * puts the reader back on the film they were actually looking at.
 *
 * The frames are the state. Nothing here decides what is on the wall; a frame's
 * data attributes do. The markup is rendered with the first frame already on
 * the wall, so a paint is always a read, never a guess, and the page is legible
 * before any of this runs.
 */

import { ClickAudio } from "../services/click-audio";

export type BioscopeFilm = {
  /** id of the review modal (and of the frame that throws it) */
  id: string;
  /** "Dune (2021)" — already how it should read on the wall */
  title: string;
  director: string;
  poster: string;
  hasReview: boolean;
  seen: boolean;
  inTheatre: boolean;
};

export type BioscopeRack = {
  /** anchor/heading id for the section, e.g. "2026" */
  slug: string;
  title: string;
  films: BioscopeFilm[];
};

export type BioscopeController = {
  /** Put the wall back on a film by id; unknown ids are ignored. */
  focus: (movieId: string, options?: ShowOptions) => void;
  /** The section that owns a film, so a closing review can return to it. */
  rackFor: (movieId: string) => HTMLElement | null;
  /** The film in the gate of the section that owns this id, so a caller can
   *  put the wall back where it found it. */
  currentIn: (movieId: string) => string | null;
};

/**
 * A wind is proportional to the ground it covers: one frame is a quick step,
 * and a row clicked further down the reel winds longer, turns the reels
 * further, and sweeps the rack past every frame in between. One duration
 * drives all of it — the ratchet, the rack's travel and the reels — so the
 * sound always stops exactly when the list does. The floor keeps a single step
 * reading as a machine moving; the ceiling keeps a jump to the end of an
 * 80-frame reel a wind rather than a wait.
 */
const WIND_PER_FRAME = 150;
const WIND_MIN_MS = 320;
const WIND_MAX_MS = 2600;
/** Past this many frames the reels and the ratchet stop growing. */
const WIND_MAX_FRAMES = 18;
/** Degrees the take-up reel and the crank turn on a one-frame wind. */
const REEL_DEG = 480;
const CRANK_DEG = 540;

/**
 * Film cells on the strip: the one in the gate plus two either side of it, so
 * the film still has frames on it when a wind runs off either end.
 */
const CELLS = 5;
const GATE_CELL = 2;

export type ShowOptions = { animate?: boolean; scroll?: boolean };

type RackState = {
  el: HTMLElement;
  show: (index: number, options?: ShowOptions) => void;
  /** id of the film in the gate — the one the reader last asked for */
  current: () => string;
};

/** How long one wind runs and how far it turns, for the ground it covers. */
type WindPlan = {
  /** how long the whole wind runs: the reels turn, the ratchet sounds and the
   *  rack sweeps for exactly this long */
  turn: number;
  /** how long one frame takes travelling through the gate, so that the run
   *  of frames takes exactly `turn` to get through */
  step: number;
  /** degrees the take-up reel turns */
  reelDeg: number;
  /** degrees the crank turns */
  crankDeg: number;
  /** ratchet teeth the wind is heard as */
  teeth: number;
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeText(value: string): string {
  return escapeAttr(value).replace(/'/g, "&#39;");
}

/**
 * A poster that fails to load bows out quietly — no src, so the browser draws
 * nothing rather than its broken-image glyph, and a placeholder tint behind it
 * so the frame or the wall is still a shape rather than a hole.
 */
const POSTER_FALLBACK =
  'onerror="this.classList.add(\'img-fallback\');this.removeAttribute(\'src\')"';

/** Hover pills over the projection: 🍿 Theatre, ✓ Watched, ✍️ Notes. The
 *  colours are the meaning — green for seen, blue for a theatre trip, ink for
 *  notes — and the words say so plainly. They are painted by mountBioscopes(). */
const watchedBadge = (film: BioscopeFilm): string =>
  film.inTheatre
    ? '<span class="wall-badge theatre" role="img" aria-label="Watched in a theatre" title="Watched in a theatre"><i class="wall-badge-icon" aria-hidden="true">🍿</i><span class="wall-badge-label">Theatre</span></span>'
    : film.seen
      ? '<span class="wall-badge seen" role="img" aria-label="Watched" title="Watched"><i class="wall-badge-icon" aria-hidden="true">✓</i><span class="wall-badge-label">Watched</span></span>'
      : "";

const NOTES_BADGE =
  '<span class="wall-badge notes" role="img" aria-label="Has notes" title="Has notes"><i class="wall-badge-icon" aria-hidden="true">✍️</i><span class="wall-badge-label">Notes</span></span>';

function badgesFor(film: BioscopeFilm): string {
  return `${watchedBadge(film)}${film.hasReview ? NOTES_BADGE : ""}`;
}

/**
 * The rack's pills. Same shapes as the wall's, except the notes pill is the way
 * into the review itself, so it has to be a real button — and a sibling of the
 * row's load button, never nested inside it, or a tap would both load the film
 * and open its notes.
 */
function rackBadges(film: BioscopeFilm): string {
  // Notes are readable via the poster modal — no need to duplicate the button
  // on the strip where space is tight and the icon clutters the poster.
  return watchedBadge(film);
}


function directorLabel(director: string): string {
  return director ? `Dir. ${director}` : "Director unknown";
}

/** One cell of the film passing through the machine. */
function cellHtml(poster: string, isGate: boolean): string {
  return `
                  <span class="film-cell${isGate ? " is-gate" : ""}">
                    ${poster ? `<img class="cell-img" src="${escapeAttr(poster)}" alt="" loading="lazy" decoding="async" ${POSTER_FALLBACK}>` : ""}
                  </span>`;
}

/**
 * The markup for one section: the projector with the film threaded through it,
 * the beam it throws, the wall that light lands on, and the rack below.
 */
export function renderBioscope(rack: BioscopeRack): string {
  const films = rack.films;
  if (!films.length) return "";

  const first = films[0];
  const total = films.length;
  const slug = escapeAttr(rack.slug);

  // A frame is a row: the poster thumbnail on the left, the film name + year
  // label beside it. Nothing wraps — the strip is tall enough to show them.
  const framesHtml = films
    .map(
      (film, index) => `
            <div class="film-frame${index === 0 ? " active" : ""}" data-id="${escapeAttr(film.id)}" data-poster="${escapeAttr(film.poster)}" data-title="${escapeAttr(film.title)}" data-director="${escapeAttr(film.director)}" data-seen="${film.seen ? "1" : "0"}" data-theatre="${film.inTheatre ? "1" : "0"}" data-review="${film.hasReview ? "1" : "0"}" title="${escapeAttr(film.title)}${film.director ? ` — ${escapeAttr(film.director)}` : ""}">
              <button type="button" class="film-frame-main" aria-label="Load ${escapeAttr(film.title)} into the projector"${index === 0 ? ' aria-current="true"' : ""}>
                <span class="film-frame-thumb">
                  ${film.poster
          ? `<img src="${escapeAttr(film.poster)}" alt="" loading="lazy" decoding="async" ${POSTER_FALLBACK}>`
          : '<span class="film-frame-blank" aria-hidden="true"></span>'}
                  <span class="film-frame-badges">${rackBadges(film)}</span>
                </span>
                <span class="film-frame-label" aria-hidden="true">${escapeText(film.title)}</span>
              </button>
            </div>`,
    )
    .join("");

  // The cells above the gate are films already through the machine; the ones
  // below are still waiting. Both are drawn, and painted by mountBioscopes().
  const cellsHtml = Array.from({ length: CELLS }, (_, slot) => {
    const filmIndex = slot - GATE_CELL;
    const film = films[filmIndex];
    return cellHtml(film ? film.poster : "", slot === GATE_CELL);
  }).join("");

  // The hover pills live on the projection itself — they are what the poster
  // says when you come close to it. The caption below stays type only.
  const projectionLabel = first.hasReview
    ? `Read my notes on ${first.title}${first.inTheatre ? " — watched in a theatre" : first.seen ? " — watched" : ""}`
    : `${first.title} — no notes yet`;

  return `
        <section class="film-roll" id="roll-${slug}" data-roll="${slug}">
          <header class="film-roll-head">
            <h2 id="${slug}">${escapeText(rack.title)}</h2>
            <p class="film-roll-meta">Sacred Saturday 'Sin'ema - ${total} film${total === 1 ? "" : "s"}</p>
          </header>

          <div class="bioscope-rig">
            <div class="bioscope-bay">
              <div class="bioscope" aria-hidden="true">
                <div class="bioscope-reels">
                  <span class="reel reel-supply"><span class="reel-disc"></span></span>
                  <span class="reel reel-takeup"><span class="reel-disc"></span></span>
                </div>
                <!-- The film runs behind the face, so only the frame in the
                     gate is inside the machine. Below the face its two runs
                     leave the box: the frame on its way up to the gate, and
                     the one that has just been through, on its way back down
                     to the drawer. -->
                <div class="film-channel">${cellsHtml}
                </div>
                <div class="bioscope-body">
                  <span class="bioscope-vent"></span>
                  <span class="bioscope-slot is-return"></span>
                  <span class="bioscope-slot is-feed"></span>
                </div>
                <span class="bioscope-gate"><i class="aperture-glow"></i></span>
                <!-- the crank: it turns with the film, the way the hand at the
                     machine would turn it -->
                <span class="bioscope-handle"><i class="handle-arm"></i></span>
                <span class="bioscope-foot"></span>
                <!-- the return run: the leader coming back down into the
                     drawer, so the strip below the machine is continuous -->
                <span class="film-run is-return" aria-hidden="true"></span>
              </div>
            </div>

            <span class="beam" aria-hidden="true"><i class="beam-cone"></i><i class="beam-dust"></i></span>

            <div class="wall">
              <div class="wall-stage">
                <span class="wall-glow" aria-hidden="true"></span>
                <button type="button" class="reel-nav prev" aria-label="Previous film"><span aria-hidden="true">‹</span></button>
                <button type="button" class="projection${first.poster ? "" : " no-art"}" data-id="${escapeAttr(first.id)}" data-review="${first.hasReview ? "1" : "0"}"${first.hasReview ? "" : " disabled"} aria-label="${escapeAttr(projectionLabel)}">
                  ${first.poster
      ? `<img class="projection-img" src="${escapeAttr(first.poster)}" alt="" decoding="async" ${POSTER_FALLBACK}>`
      : ""}
                  <span class="wall-badges" aria-hidden="true">${badgesFor(first)}</span>
                  <span class="projection-scratch" aria-hidden="true"></span>
                </button>
                <button type="button" class="reel-nav next" aria-label="Next film"><span aria-hidden="true">›</span></button>
              </div>                <div class="wall-info" aria-live="polite">
                  <h3 class="wall-title">${escapeText(first.title)}</h3>
                  <p class="wall-meta">
                    <span class="wall-director">${escapeText(directorLabel(first.director))}</span>
                    <span class="wall-count">1 / ${total}</span>
                  </p>
                </div>
            </div>
          </div>

          <div class="film-strip-wrap">
            <div class="film-strip-container">
              <div class="film-strip" role="group" aria-label="Films in this reel">${framesHtml}
              </div>
            </div>
          </div>
        </section>`;
}

/**
 * Bring every rack on the page to life: arrows and frames load a film into the
 * projector, a review opened from the wall (or skimmed with the arrows inside
 * the modal) repaints the wall behind it.
 */
export function mountBioscopes(
  openReview: (movieId: string) => void,
): BioscopeController {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * How far and how long one wind runs. One frame is a quick step; the further
   * the film has to travel, the longer the reels turn, the further the reel is
   * wound, the further the rack is swept and the longer the ratchet is heard —
   * all of it off the single `turn`, so the sound and the travel through the
   * list are the same length to the millisecond.
   */
  const windFor = (distance: number): WindPlan => {
    const span = Math.abs(distance);
    const frames = Math.min(span, WIND_MAX_FRAMES);
    const turn = reducedMotion
      ? 0
      : Math.round(
        Math.max(WIND_MIN_MS, Math.min(WIND_MAX_MS, span * WIND_PER_FRAME)),
      );
    // the reel turns further the further the film has to travel, easing off
    // past a dozen frames or so
    const turns = 1 + Math.sqrt(frames);
    return {
      turn,
      // one frame per `step`, and the frames add up to the whole wind: the
      // picture runs through the gate for exactly as long as the ratchet
      step: reducedMotion
        ? 0
        : Math.max(28, Math.round(turn / Math.max(1, span))),
      reelDeg: Math.round(REEL_DEG * turns),
      crankDeg: Math.round(CRANK_DEG * turns),
      // a tooth per frame travelled, floored so even a single step clatters
      // like a machine with film running through it
      teeth: Math.max(3, Math.min(38, Math.round(frames) + 2)),
    };
  };
  const byMovie = new Map<string, { rack: RackState; index: number }>();

  document.querySelectorAll<HTMLElement>(".film-roll").forEach((rollEl) => {
    const strip = rollEl.querySelector<HTMLElement>(".film-strip");
    const machine = rollEl.querySelector<HTMLElement>(".bioscope");
    const channel = rollEl.querySelector<HTMLElement>(".film-channel");
    const stage = rollEl.querySelector<HTMLElement>(".wall-stage");
    const projection = rollEl.querySelector<HTMLButtonElement>(".projection");
    const projectionImg = rollEl.querySelector<HTMLImageElement>(".projection-img");
    const glow = rollEl.querySelector<HTMLElement>(".wall-glow");
    const titleEl = rollEl.querySelector<HTMLElement>(".wall-title");
    const directorEl = rollEl.querySelector<HTMLElement>(".wall-director");
    const countEl = rollEl.querySelector<HTMLElement>(".wall-count");
    const badgeEl = rollEl.querySelector<HTMLElement>(".wall-badges");
    const wallInfo = rollEl.querySelector<HTMLElement>(".wall-info");
    const frames = Array.from(rollEl.querySelectorAll<HTMLElement>(".film-frame"));
    const channelEl = rollEl.querySelector<HTMLElement>(".film-channel");
    let cells = Array.from(rollEl.querySelectorAll<HTMLElement>(".film-cell"));

    if (!strip || !machine || !projection || !projectionImg || !titleEl || !frames.length) {
      return;
    }

    let index = 0;

    /**
     * The reel is a column beside the picture on a wide screen and a row under
     * it on a narrow one, so which way it travels is read from the layout
     * rather than assumed.
     */
    const rackIsRow = () => getComputedStyle(strip).flexDirection === "row";
    const rackRead = (row: boolean) => (row ? strip.scrollLeft : strip.scrollTop);
    const rackSize = (row: boolean) => (row ? strip.clientWidth : strip.clientHeight);
    const rackWrite = (row: boolean, value: number) => {
      if (row) strip.scrollLeft = value;
      else strip.scrollTop = value;
    };

    /** Where the reel has to sit for a frame to be in view (null if it is). */
    const rackOffsetFor = (i: number, row: boolean): number | null => {
      const frame = frames[i];
      if (!frame) return null;
      const start = row ? frame.offsetLeft : frame.offsetTop;
      const end = start + (row ? frame.offsetWidth : frame.offsetHeight);
      const viewStart = rackRead(row);
      const viewSize = rackSize(row);
      if (start < viewStart) return Math.max(0, start - 8);
      if (end > viewStart + viewSize) return end - viewSize + 8;
      return null;
    };

    /**
     * Keep the frame the machine is on in view without moving the page: the
     * reel travels, the room stays put. Just enough travel to show the frame —
     * never a jump to centre it.
     */
    const revealFrame = (i: number, smooth: boolean) => {
      const row = rackIsRow();
      const target = rackOffsetFor(i, row);
      if (target === null) return;
      const behavior = smooth && !reducedMotion ? "smooth" : "auto";
      if (row) strip.scrollTo({ left: target, behavior });
      else strip.scrollTo({ top: target, behavior });
    };

    /**
     * Wind the rack to a row over a given time. A jump down the reel sweeps
     * past every frame between here and there instead of skipping them, so the
     * reel reads as being wound rather than cut — and the caller hands in the
     * same duration it gave the ratchet, so the sound and the list start and
     * stop together. The reader's own hand on the rack always wins.
     */
    let scrollRaf = 0;
    const scrollRackTo = (i: number, durationMs: number) => {
      const row = rackIsRow();
      const target = rackOffsetFor(i, row);
      if (target === null) return;
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      const from = rackRead(row);
      const delta = target - from;
      if (durationMs <= 0 || reducedMotion || Math.abs(delta) < 1) {
        rackWrite(row, target);
        return;
      }
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / durationMs);
        // a reel starts, runs, and settles rather than starting at full speed
        const eased =
          t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        rackWrite(row, from + delta * eased);
        scrollRaf = t < 1 ? requestAnimationFrame(step) : 0;
      };
      scrollRaf = requestAnimationFrame(step);
    };

    // The reader's own hand on the rack wins over the machine winding it.
    strip.addEventListener(
      "wheel",
      () => {
        if (!scrollRaf) return;
        cancelAnimationFrame(scrollRaf);
        scrollRaf = 0;
      },
      { passive: true },
    );

    /** One cell of the strip, holding one frame of the reel. */
    const paintCell = (cell: HTMLElement, film: HTMLElement | undefined) => {
      const poster = film ? film.dataset.poster || "" : "";
      let img = cell.querySelector<HTMLImageElement>(".cell-img");
      if (!poster) {
        // No film on this cell: take the image out altogether. An <img> left
        // behind with no src still draws the browser's broken-image glyph in
        // some engines, which is what showed just outside the machine at the
        // first and last frame of a reel.
        if (img) {
          img.remove();
          img = null;
        }
        cell.classList.add("is-blank");
        return;
      }
      if (!img) {
        img = document.createElement("img");
        img.className = "cell-img";
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        // A dead poster leaves the cell blank rather than broken.
        img.addEventListener("error", () => {
          if (!img) return;
          img.classList.add("img-fallback");
          img.removeAttribute("src");
        });
        cell.appendChild(img);
      }
      img.src = poster;
      cell.classList.remove("is-blank");
    };

    /**
     * The film in the machine: the gate cell holds the loaded film, the cells
     * either side hold the one before it and the one after it. A cell past the
     * end of the section stays blank — there is no film there to show.
     */
    const paintFilm = (i: number) => {
      cells.forEach((cell, slot) => {
        paintCell(cell, frames[i + slot - GATE_CELL]);
        cell.classList.toggle("is-gate", slot === GATE_CELL);
      });
    };

    /**
     * The film has travelled one frame, so the strip has one frame less on the
     * supply side and one more wound on. Rotate the cells to match where the
     * film now is and reset the offset in the same paint — the frames already
     * on screen keep their own marked frame of the reel, so nothing on the
     * strip is repainted in view and the reel really is being spent, one frame
     * at a time, rather than a highlight walking from frame to frame.
     */
    const rotateFilm = (i: number, direction: 1 | -1) => {
      if (!channelEl) return;
      const last = cells.length - 1;
      if (direction > 0) channelEl.appendChild(cells[0]);
      else channelEl.prepend(cells[last]);
      cells = Array.from(channelEl.children) as HTMLElement[];
      // The recycled cell arrives on the far side of the box, still out of
      // shot behind the fade, carrying the frame that side of the window ends
      // on: the film has moved a frame towards that end of the reel.
      const recycled = cells[direction > 0 ? cells.length - 1 : 0];
      paintCell(recycled, frames[i + direction * GATE_CELL]);
      cells.forEach((cell, slot) => cell.classList.toggle("is-gate", slot === GATE_CELL));
    };

    /**
     * What the beam shows for one film: the poster, the glow spilling off it
     * and the caption underneath. This is the part of the wall a wind repaints
     * frame by frame, so a jump down the strip reads as posters running through
     * the light rather than a blank wait and a cut. The parts that must not
     * move mid-wind — which film the wall *is* to a click or a reader, and the
     * rack's highlight — belong to paintWall(), which settles them at the end.
     */
    const paintProjection = (i: number) => {
      const frame = frames[i];
      if (!frame) return;
      const poster = frame.dataset.poster || "";
      const label = frame.dataset.title || "";
      const director = frame.dataset.director || "";

      if (poster) {
        projectionImg.src = poster;
        // A new film clears the placeholder left by a poster that failed.
        projectionImg.classList.remove("img-fallback");
      } else {
        // A frame with no art throws nothing: a bare glow, not the last poster.
        projectionImg.removeAttribute("src");
      }
      projectionImg.alt = label ? `${label} poster` : "";
      projection.classList.toggle("no-art", !poster);
      if (glow) glow.style.backgroundImage = poster ? `url("${poster}")` : "none";

      titleEl.textContent = label;
      if (directorEl) directorEl.textContent = directorLabel(director);
      if (countEl) countEl.textContent = `${i + 1} / ${frames.length}`;
      if (badgeEl) {
        badgeEl.innerHTML = badgesFor({
          id: frame.dataset.id || "",
          title: label,
          director,
          poster,
          hasReview: frame.dataset.review === "1",
          seen: frame.dataset.seen === "1",
          inTheatre: frame.dataset.theatre === "1",
        });
      }
    };

    /** The wall, the title card and the notes button for one film. */
    const paintWall = (i: number) => {
      const frame = frames[i];
      if (!frame) return;
      const label = frame.dataset.title || "";
      const hasReview = frame.dataset.review === "1";
      const movieId = frame.dataset.id || "";

      index = i;

      paintProjection(i);

      projection.dataset.id = movieId;
      projection.dataset.review = hasReview ? "1" : "0";
      projection.disabled = !hasReview;
      const seen = frame.dataset.seen === "1";
      const inTheatre = frame.dataset.theatre === "1";
      projection.setAttribute(
        "aria-label",
        hasReview
          ? `Read my notes on ${label}${inTheatre ? " — watched in a theatre" : seen ? " — watched" : ""}`
          : `${label} — no notes yet`,
      );

      frames.forEach((frameEl, fi) => {
        const active = fi === i;
        frameEl.classList.toggle("active", active);
        const main = frameEl.querySelector(".film-frame-main");
        if (!main) return;
        if (active) main.setAttribute("aria-current", "true");
        else main.removeAttribute("aria-current");
      });

      // at the ends of the reel the arrow that has nowhere to go is spent
      if (prevBtn) prevBtn.disabled = i <= 0;
      if (nextBtn) nextBtn.disabled = i >= frames.length - 1;
    };

    const paint = (i: number) => {
      paintWall(i);
      paintFilm(i);
    };


    /** One frame starts moving: the cell on the incoming side is lit and the
     *  channel begins its travel — the reels turn straight through it. */
    const startTravel = (direction: 1 | -1) => {
      if (!channel) return;
      cells.forEach((cell, slot) =>
        cell.classList.toggle("is-gate", slot === GATE_CELL + direction),
      );
      channel.classList.remove("is-advancing", "is-rewinding");
      void channel.offsetWidth;
      channel.classList.add(direction > 0 ? "is-advancing" : "is-rewinding");
    };

    /** Start the film travelling: the cell on the incoming side gets lit. */
    const startWind = (direction: 1 | -1, plan: WindPlan) => {
      startTravel(direction);
      machine.classList.remove("is-turning");
      machine.style.setProperty("--turn-direction", String(direction));
      // How long this wind runs and how long one frame takes to travel, handed
      // to the machine's own animations: the reels turn further and for longer
      // the further the film has to travel, so the machine winds like one with
      // film in it — and every frame takes as long as `step`, so the whole run
      // of frames adds up to `turn`.
      machine.style.setProperty("--reel-turn", `${plan.turn}ms`);
      machine.style.setProperty("--slide-ms", `${plan.step}ms`);
      machine.style.setProperty("--turn-deg", `${plan.reelDeg}deg`);
      machine.style.setProperty("--crank-deg", `${plan.crankDeg}deg`);
      void machine.offsetWidth;
      machine.classList.add("is-turning");
    };

    /**
     * One frame has arrived in the gate: the window turns to include it and the
     * offset resets in the same paint, so the next frame can start travelling
     * straight away without the strip ever jumping under the mask.
     */
    const passOne = (atIndex: number, direction: 1 | -1) => {
      if (channel && channelEl) {
        channel.classList.add("is-settling");
        channel.classList.remove("is-advancing", "is-rewinding");
        rotateFilm(atIndex, direction);
        void channel.offsetWidth;
        channel.classList.remove("is-settling");
      } else {
        paintFilm(atIndex);
      }
      // The beam travels with the film. Every frame that passes the gate is
      // thrown on the wall for its moment in the wind, so a long jump runs the
      // posters through the light in step with the cells behind the mask — the
      // wall flickers exactly where the film does. paintWall() settles the
      // caption, the notes button and the rack when the film lands.
      paintProjection(atIndex);
    };


    /** Stop the film where a fresh frame sits in the gate, mid-frame if we are
     *  cutting a wind short. */
    const settleWind = (i: number, direction: 1 | -1, from: number) => {
      if (channel && channelEl) {
        channel.classList.add("is-settling");
        channel.classList.remove("is-advancing", "is-rewinding");
        // One frame on: the strip can simply be turned on the reel. Further
        // than that is a splice, and the whole window has to be re-cut.
        if (Math.abs(i - from) === 1) rotateFilm(i, direction);
        else paintFilm(i);
        // flush the layout so the offset resets before transitions come back
        void channel.offsetWidth;
        channel.classList.remove("is-settling");
      } else {
        paintFilm(i);
      }
      machine.classList.remove("is-turning");
      // The wind has stopped, so the wall is worth listening to again — the
      // caption settles here on the film that was asked for.
      wallInfo?.setAttribute("aria-live", "polite");
    };

    // Winding on: the reels turn, the film travels one frame, the lens flares.
    // The machine itself does not move.
    let turnToken = 0;
    let winding = false;
    /** Pending frame timer for the wind in progress (0 when none is due). */
    let windTimer = 0;
    /** The frame actually sitting in the gate, which lags `index` a wind by. */
    let settled = 0;

    const show = (i: number, options: ShowOptions = {}) => {
      const { animate = true, scroll = true } = options;
      if (i < 0 || i >= frames.length) return;
      if (i === index) {
        if (scroll) revealFrame(i, true);
        return;
      }
      const direction: 1 | -1 = i > index ? 1 : -1;
      const from = settled;
      // the ground this wind really covers: where the film is, not where the
      // last request left it
      const plan = windFor(i - from);

      // A second tap mid-wind is not swallowed, but it does not queue either:
      // the film simply arrives where the newest tap asked for it.
      if (!animate || reducedMotion || winding) {
        turnToken += 1;
        winding = false;
        // The reader cut the wind short — so the machine stops where it is,
        // the rack stops travelling, and the sound of the wind they abandoned
        // stops with it instead of running on out of sight.
        ClickAudio.stopWind();
        // `index` is the film the reader asked for, so it moves on every
        // request — even one that cuts a wind short — or a hand that taps
        // faster than the film travels would step from a stale place.
        index = i;
        settleWind(i, direction, from);
        settled = i;
        paintWall(i);
        if (scroll) scrollRackTo(i, 0);
        return;
      }

      index = i;
      turnToken += 1;
      const mine = turnToken;
      winding = true;

      // The caption is rewritten frame by frame while the film runs, which a
      // live region would read out as a stammer of titles. Quiet it for the
      // wind; settleWind() turns it back on with the film that landed.
      wallInfo?.setAttribute("aria-live", "off");

      ClickAudio.playWind(plan.teeth, plan.turn);
      startWind(direction, plan);
      // The rack travels with the wind: every frame between here and the one
      // asked for is swept past, over exactly as long as the ratchet is heard.
      if (scroll) scrollRackTo(i, plan.turn);

      // Every frame between here and there is wound through the gate one at a
      // time, spread over exactly as long as the ratchet runs — so the picture
      // in the machine loops through the whole run of films instead of showing
      // two and leaping to the last. The wall is thrown each of those frames
      // too (passOne paints it), while the caption, the notes button and the
      // rack are settled only once the last frame has arrived — so the wall
      // flickers with the film and the room is never left half-told.
      const distance = Math.max(1, Math.abs(i - from));
      let travelled = 0;
      let lastTick = performance.now();
      const runFrame = () => {
        if (mine !== turnToken) return;
        windTimer = 0;
        // A hidden tab throttles timers to about once a second, so the next
        // tick can turn up long after it was due. Advance by however many
        // frames that silence is worth instead of letting the wind crawl
        // behind the clock and jump when the reader returns.
        const now = performance.now();
        const due = Math.max(1, Math.floor((now - lastTick) / plan.step) + 1);
        lastTick += due * plan.step;
        travelled = Math.min(distance, travelled + due);
        if (travelled >= distance) {
          // the film lands exactly on the row that was asked for
          settleWind(i, direction, from);
          settled = i;
          paintWall(i);
          winding = false;
          return;
        }
        // that frame is in the gate; wind the next one in behind it
        passOne(from + direction * travelled, direction);
        startTravel(direction);
        windTimer = window.setTimeout(runFrame, plan.step);
      };
      windTimer = window.setTimeout(runFrame, plan.step);
      window.setTimeout(() => {
        if (mine !== turnToken) return;
        machine.classList.remove("is-turning");
      }, plan.turn + 80);
    };

    // The reel has two ends. Winding back from the first film does not put you
    // on the last one — a reel is a strip, not a loop.
    const step = (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= frames.length) return;
      show(next);
    };

    const prevBtn = rollEl.querySelector<HTMLButtonElement>(".reel-nav.prev");
    const nextBtn = rollEl.querySelector<HTMLButtonElement>(".reel-nav.next");
    prevBtn?.addEventListener("click", () => step(-1));
    nextBtn?.addEventListener("click", () => step(1));

    frames.forEach((frame, i) => {
      frame
        .querySelector<HTMLButtonElement>(".film-frame-main")
        ?.addEventListener("click", () => show(i));
      // The notes pill opens the review on its own, without also threading the
      // film — the projector follows the review anyway (openReview focuses it).
      frame
        .querySelector<HTMLButtonElement>(".film-notes-btn")
        ?.addEventListener("click", (event) => {
          event.stopPropagation();
          const movieId = frame.dataset.id;
          if (movieId) openReview(movieId);
        });
    });

    projection.addEventListener("click", () => {
      const movieId = projection.dataset.id;
      if (movieId && projection.dataset.review === "1") openReview(movieId);
    });

    // Left/right on a focused wall turns the reel, unless a review is open —
    // then those keys belong to the review's skim controls.
    projection.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (document.querySelector(".movie-review-modal.active")) return;
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
    });

    // Swipe the wall (touch), the same gesture the review modal uses.
    if (stage) {
      let startX = 0;
      let startY = 0;
      stage.addEventListener("touchstart", (event) => {
        const touch = event.changedTouches[0];
        startX = touch.clientX;
        startY = touch.clientY;
      }, { passive: true });
      stage.addEventListener("touchend", (event) => {
        const touch = event.changedTouches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          step(dx < 0 ? 1 : -1);
        }
      }, { passive: true });
    }

    const rack: RackState = {
      el: rollEl,
      show,
      // the film the reader last asked for — what the rack has selected
      current: () => frames[index]?.dataset.id || "",
    };
    frames.forEach((frame, i) => {
      const movieId = frame.dataset.id;
      if (movieId) byMovie.set(movieId, { rack, index: i });
    });

    // Nobody can see a hidden tab, and timers are throttled to roughly once a
    // second there — so a wind that was mid-flight would sit half-turned until
    // well after the reader came back. Finish it straight away instead, and
    // the tab returns to a reel already where they left it.
    const onVisibility = () => {
      if (!rollEl.isConnected) {
        document.removeEventListener("visibilitychange", onVisibility);
        return;
      }
      if (!document.hidden || !winding) return;
      if (windTimer) {
        window.clearTimeout(windTimer);
        windTimer = 0;
      }
      const target = index;
      const dir: 1 | -1 = target >= settled ? 1 : -1;
      turnToken += 1;
      winding = false;
      settleWind(target, dir, settled);
      settled = target;
      paintWall(target);
      scrollRackTo(target, 0);
      ClickAudio.stopWind();
    };
    document.addEventListener("visibilitychange", onVisibility);

    paint(0);
    revealFrame(0, false);
  });

  return {
    focus(movieId: string, options?: ShowOptions) {
      const hit = byMovie.get(movieId);
      if (hit) hit.rack.show(hit.index, options);
    },
    rackFor(movieId: string) {
      return byMovie.get(movieId)?.rack.el ?? null;
    },
    currentIn(movieId: string) {
      return byMovie.get(movieId)?.rack.current() || null;
    },
  };
}
