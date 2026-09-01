/**
 * Flowers, drawn from scratch.
 *
 * Every bloom on the homepage is generated SVG — no image assets to keep in
 * sync. A flower is a function of its own progress: stem length, leaf size,
 * bud and petal openness all read from the same 0→1 number, so one code path
 * paints a sprout, a tight bud and a camellia in full flower.
 */

import type { FlowerSpecies } from "../services/garden";

export type Placement = {
  /** Horizontal position in scene units. */
  x: number;
  /** Where the plant meets the soil. */
  baseY: number;
  scale: number;
};

const round = (v: number): number => Math.round(v * 100) / 100;

/** Tiny string hash → [0,1). Same flower, same jitter, every render. */
export function hashUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0 || 1;
  const t = clamp01((x - edge0) / span);
  return t * t * (3 - 2 * t);
}

type Point = [number, number];

/** A point along a quadratic Bézier. */
function quad(p0: Point, p1: Point, p2: Point, u: number): Point {
  const m = 1 - u;
  return [
    m * m * p0[0] + 2 * m * u * p1[0] + u * u * p2[0],
    m * m * p0[1] + 2 * m * u * p1[1] + u * u * p2[1],
  ];
}

/**
 * A closed leaf/petal outline: origin at the base, tip at (0, -len),
 * widest around `widest` of the way up.
 */
function bladePath(len: number, width: number, widest = 0.5): string {
  const shoulder = -len * widest;
  return (
    `M0 0 C ${round(width)} ${round(shoulder)} ${round(width * 0.55)} ${round(-len * 0.88)} 0 ${round(-len)} ` +
    `C ${round(-width * 0.55)} ${round(-len * 0.88)} ${round(-width)} ${round(shoulder)} 0 0 Z`
  );
}

/** Leaf sizes and counts per foliage style. */
function foliageSpec(species: FlowerSpecies): {
  count: number;
  len: number;
  width: number;
  leaflet: boolean;
} {
  const unit = species.height;
  switch (species.foliage) {
    case "slender":
      return { count: 4, len: unit * 0.28, width: unit * 0.032, leaflet: false };
    case "broad":
      return { count: 4, len: unit * 0.24, width: unit * 0.085, leaflet: false };
    case "camellia":
      return { count: 4, len: unit * 0.23, width: unit * 0.07, leaflet: false };
    case "feathery":
      return { count: 6, len: unit * 0.13, width: unit * 0.028, leaflet: true };
  }
}

/** Leaves along the stem, appearing in pairs as the plant grows. */
function foliageMarkup(species: FlowerSpecies, height: number, lean: number, t: number): string {
  const p0: Point = [0, 0];
  const p1: Point = [lean * height * 0.42, -height * 0.55];
  const p2: Point = [lean * height, -height];
  const spec = foliageSpec(species);
  const pairs = spec.count / 2;
  // Anchors stay below the flower, so leaves never cross the bloom.
  const anchors = pairs === 3 ? [0.3, 0.52, 0.7] : [0.45, 0.7];

  const parts: string[] = [];
  for (let pair = 0; pair < pairs; pair++) {
    const anchor = anchors[pair];
    const appears = 0.1 + pair * 0.08;
    const grow = smoothstep(appears, appears + 0.18, t);
    if (grow <= 0.01) continue;

    const [ax, ay] = quad(p0, p1, p2, anchor);
    for (const side of [-1, 1]) {
      const seed = `${species.id}-leaf-${pair}-${side}`;
      const jitter = hashUnit(seed);
      const angle = side * (44 + jitter * 18);
      const len = spec.len * grow * (0.86 + jitter * 0.28) * (1 - 0.14 * pair);
      const width = spec.width * grow * (0.9 + jitter * 0.2);
      const droop = species.foliage === "slender" ? 0.62 : 0.5;

      const leaflets = spec.leaflet
        ? [0, 1, 2]
            .map((i) => {
              const offset = len * 0.22 + i * len * 0.3;
              return (
                `<g transform="translate(0 ${round(-offset)})">` +
                `<path d="${bladePath(len * 0.36, width * 1.5)}" style="fill:var(${species.leafVar})"/>` +
                `</g>`
              );
            })
            .join("")
        : "";

      const vein =
        species.foliage === "camellia"
          ? `<path d="M0 0 L0 ${round(-len * 0.92)}" style="stroke:var(--garden-leaf-vein)" stroke-width="0.7" fill="none" opacity="0.8"/>`
          : `<path d="M0 0 L0 ${round(-len * 0.85)}" style="stroke:var(${species.leafVar})" stroke-width="0.6" fill="none" opacity="0.5"/>`;

      parts.push(
        `<g transform="translate(${round(ax)} ${round(ay)}) rotate(${round(angle)})" opacity="${round(0.55 + 0.45 * grow)}">` +
          `<path d="${bladePath(len, width, droop)}" style="fill:var(${species.leafVar})"/>` +
          vein +
          (spec.leaflet ? `<path d="M0 0 L0 ${round(-len)}" style="stroke:var(${species.leafVar})" stroke-width="0.7" fill="none"/>` : "") +
          leaflets +
          `</g>`
      );
    }
  }
  return parts.join("");
}

/** The closed bud, with its green sepals wrapping the base. */
function budMarkup(species: FlowerSpecies, size: number, opacity: number): string {
  const h = size * 1.35;
  const w = size * 0.62;
  return (
    `<g opacity="${round(opacity)}">` +
    `<path d="M0 0 C ${round(w)} ${round(-h * 0.3)} ${round(w * 0.5)} ${round(-h)} 0 ${round(-h)} ` +
    `C ${round(-w * 0.5)} ${round(-h)} ${round(-w)} ${round(-h * 0.3)} 0 0 Z" ` +
    `style="fill:var(${species.petalVar})" stroke="var(${species.petalDeepVar})" stroke-width="0.6"/>` +
    `<path d="M0 ${round(-h * 0.04)} C ${round(w * 0.92)} ${round(-h * 0.24)} ${round(w * 0.52)} ${round(-h * 0.6)} 0 ${round(-h * 0.55)} ` +
    `C ${round(-w * 0.52)} ${round(-h * 0.6)} ${round(-w * 0.92)} ${round(-h * 0.24)} 0 ${round(-h * 0.04)} Z" ` +
    `style="fill:var(${species.leafVar})"/>` +
    `<path d="M${round(-w * 0.55)} 0 Q 0 ${round(-h * 0.16)} ${round(w * 0.55)} 0 Q 0 ${round(h * 0.12)} ${round(-w * 0.55)} 0 Z" ` +
    `style="fill:var(${species.leafVar})" opacity="0.85"/>` +
    `</g>`
  );
}

/** The open bloom: concentric rings of petals, then the eye and stamens. */
function petalsMarkup(species: FlowerSpecies, radius: number, open: number): string {
  const parts: string[] = [];
  const squash = 0.74 + 0.26 * open;
  const narrow = species.petals > 16 ? 0.54 : 1;

  // Soft halo so an open flower lifts off the page a little. A radial
  // gradient instead of a blur filter: same glow, no per-frame rasterisation
  // cost, which is what keeps phones smooth.
  parts.push(
    `<circle class="garden-bloom-halo" r="${round(radius * 2.1)}" fill="url(#garden-glow-${species.id})" opacity="${round(
      0.55 + 0.45 * open
    )}"/>`
  );

  parts.push(`<g transform="scale(1 ${round(squash)})">`);
  for (let layer = 0; layer < species.layers; layer++) {
    const shrink = 1 - layer * 0.19;
    const len = radius * shrink;
    const width = len * (0.28 + 0.34 * species.petalShape) * narrow;
    const offset = (layer * 180) / species.petals;
    for (let i = 0; i < species.petals; i++) {
      const angle = (i * 360) / species.petals + offset;
      // Outer ring wears the deeper tone; inner rings catch the light.
      const fill = layer === 0 && i % 2 === 1 ? species.petalDeepVar : species.petalVar;
      parts.push(
        `<path d="${bladePath(len, width, 0.46)}" transform="rotate(${round(angle)})" ` +
          `style="fill:var(${fill})" stroke="var(${species.petalDeepVar})" stroke-width="0.45" stroke-opacity="0.5"/>`
      );
    }
  }
  parts.push(`</g>`);

  if (open > 0.3) {
    parts.push(
      `<circle r="${round(radius * 0.3)}" style="fill:var(${species.petalDeepVar})" opacity="${round(0.25 * open)}"/>`
    );
  }

  if (open > 0.34) {
    const eye = radius * (0.14 + 0.1 * open);
    parts.push(`<circle r="${round(eye)}" style="fill:var(${species.centerVar})"/>`);
    if (open > 0.72) {
      const ring = radius * 0.28;
      const stamens: string[] = [];
      for (let i = 0; i < 9; i++) {
        const angle = (i * 360) / 9;
        const [sx, sy] = [Math.cos((angle * Math.PI) / 180) * ring, Math.sin((angle * Math.PI) / 180) * ring];
        stamens.push(
          `<circle cx="${round(sx)}" cy="${round(sy)}" r="${round(eye * 0.42)}" style="fill:var(${species.centerVar})" opacity="0.9"/>`
        );
      }
      parts.push(stamens.join(""));
    }
  }
  return parts.join("");
}

/**
 * Seed leaves. A brand-new garden is thirteen of these, so the bed reads as
 * planted from the very first second.
 */
function sproutMarkup(species: FlowerSpecies, t: number): string {
  const opacity = 1 - smoothstep(0.16, 0.34, t);
  if (opacity <= 0.01) return "";
  const size = 5.5 + 3 * smoothstep(0, 0.3, t);
  return (
    `<g opacity="${round(opacity)}">` +
    [1, -1]
      .map(
        (side) =>
          `<g transform="rotate(${round(side * 58)})">` +
          `<path d="${bladePath(size, size * 0.52, 0.55)}" style="fill:var(${species.leafVar})"/>` +
          `</g>`
      )
      .join("") +
    `</g>`
  );
}

/** Bud and bloom at the tip of the stem. */
function bloomMarkup(species: FlowerSpecies, t: number, stemHeight: number): string {
  const budGrow = smoothstep(0.24, 0.62, t);
  const budFade = 1 - smoothstep(0.5, 0.74, t);
  const budOpacity = smoothstep(0.22, 0.32, t) * budFade;
  const open = smoothstep(0.48, 0.95, t);

  const parts: string[] = [];
  if (budOpacity > 0.01) {
    const size = Math.min(species.bloomRadius * 0.95, stemHeight * 0.32) * (0.45 + 0.55 * budGrow);
    parts.push(budMarkup(species, size, budOpacity));
  }
  if (open > 0.01) {
    const radius = species.bloomRadius * (0.45 + 0.55 * open);
    parts.push(petalsMarkup(species, radius, open));
  }
  return parts.join("");
}

/**
 * Every flower paints its own glow, so the gradients are per-species and
 * carry the species colour from the theme's palette.
 */
export function sceneDefsMarkup(speciesList: FlowerSpecies[]): string {
  const sun =
    `<radialGradient id="garden-sun-disc" cx="40%" cy="36%" r="66%">` +
    `<stop offset="0%" style="stop-color:var(--garden-sun-core)"/>` +
    `<stop offset="100%" style="stop-color:var(--garden-sun-edge)"/>` +
    `</radialGradient>` +
    `<radialGradient id="garden-sun-glow">` +
    `<stop offset="0%" style="stop-color:var(--garden-sun-glow); stop-opacity:0.55"/>` +
    `<stop offset="50%" style="stop-color:var(--garden-sun-glow); stop-opacity:0.15"/>` +
    `<stop offset="100%" style="stop-color:var(--garden-sun-glow); stop-opacity:0"/>` +
    `</radialGradient>`;

  const glows = speciesList
    .map(
      (species) =>
        `<radialGradient id="garden-glow-${species.id}">` +
        `<stop offset="0%" style="stop-color:var(${species.petalVar}); stop-opacity:0.45"/>` +
        `<stop offset="55%" style="stop-color:var(${species.petalVar}); stop-opacity:0.13"/>` +
        `<stop offset="100%" style="stop-color:var(${species.petalVar}); stop-opacity:0"/>` +
        `</radialGradient>`
    )
    .join("");

  return `<defs>${sun}${glows}</defs>`;
}

/**
 * The light in the sky. Every theme gets its own celestial body: a moon for
 * the dark theme, a sun with rays for the light one, a ringed neon planet
 * for the Y2K theme — so a garden read at midnight still looks lit by
 * something rather than growing in the dark.
 */
export function sunMarkup(width: number, height: number): string {
  const cx = width * 0.82;
  const cy = height * 0.21;
  const r = 26;
  const rays: string[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    const inner = r * 1.42;
    const outer = inner + 9;
    rays.push(
      `<line x1="${round(Math.cos(angle) * inner)}" y1="${round(Math.sin(angle) * inner)}" ` +
        `x2="${round(Math.cos(angle) * outer)}" y2="${round(Math.sin(angle) * outer)}" ` +
        `style="stroke:var(--garden-sun-ray)" stroke-width="1.7" stroke-linecap="round"/>`
    );
  }
  // Placement lives on the outer group and the drift animation on the inner
  // one: a CSS transform would otherwise replace the positioning attribute.
  return (
    `<g transform="translate(${round(cx)} ${round(cy)})">` +
    `<g class="garden-sun">` +
    `<circle r="${round(r * 6.2)}" fill="url(#garden-sun-glow)"/>` +
    `<g class="garden-sun-rays">${rays.join("")}</g>` +
    `<circle r="${r}" fill="url(#garden-sun-disc)"/>` +
    `<g class="garden-orbit">` +
    `<ellipse rx="${round(r * 2.3)}" ry="${round(r * 0.6)}" transform="rotate(-16)" ` +
    `fill="none" style="stroke:var(--garden-sun-ray)" stroke-width="1.3" stroke-opacity="0.8"/>` +
    `</g>` +
    `</g>` +
    `</g>`
  );
}

/**
 * The seed marker: one per plant, planted in the soil and always visible, so
 * there is something to hover (or tap) at every station in the bed.
 */
export function seedMarkerSvg(species: FlowerSpecies, x: number, y: number, bloomed: boolean): string {
  const jitter = hashUnit(`${species.id}-seed`);
  const ox = round((species.lean >= 0 ? -1 : 1) * (7 + jitter * 6));
  // A seed is soil-coloured while its plant is still coming; once the flower
  // has opened the marker takes the flower's own colour.
  const classes = bloomed ? "garden-seed is-bloomed" : "garden-seed";
  const body = bloomed ? `var(${species.petalVar})` : "var(--garden-seed)";
  const ring = bloomed ? ` style="stroke:var(${species.petalVar})"` : "";
  return (
    `<g class="${classes}" data-flower="${species.id}" transform="translate(${round(x + ox)} ${round(y)})">` +
    // generous invisible target: fingers need more than a seed's width
    `<circle class="garden-seed-hit" r="24" fill="transparent"/>` +
    `<ellipse class="garden-seed-shadow" cy="2.6" rx="9" ry="2.4"/>` +
    `<circle class="garden-seed-ring" r="9" fill="none"${ring}/>` +
    `<ellipse class="garden-seed-body" rx="3.6" ry="4.8" transform="rotate(${round(
      -14 + jitter * 28
    )})" style="fill:${body}"/>` +
    `</g>`
  );
}

/**
 * One whole plant: outer group places it in the bed, the inner group sways
 * around the base (its local origin, so a rotation never uproots anything).
 */
export function flowerSvg(
  species: FlowerSpecies,
  progress: number,
  place: Placement,
  bloomed: boolean
): string {
  const t = clamp01(progress);
  const grow = smoothstep(0, 0.74, t);
  const height = 11 + (species.height - 11) * grow;
  const lean = species.lean * (0.7 + 0.5 * hashUnit(`${species.id}-lean`));
  const tipX = lean * height;
  const tipY = -height;
  const ctrlX = tipX * 0.42;
  const ctrlY = -height * 0.55;
  const stemWidth = species.foliage === "camellia" ? 2.6 : 1.8;
  const swayAmp = round((0.5 + 0.6 * hashUnit(`${species.id}-sway`)) * (0.4 + 0.6 * grow));
  const swayDelay = -round(hashUnit(`${species.id}-delay`) * 9);

  const classes = ["garden-flower"];
  if (bloomed) classes.push("is-blooming");
  if (bloomed && t >= 1) classes.push("is-open");

  return (
    `<g class="${classes.join(" ")}" data-flower="${species.id}" ` +
    `transform="translate(${round(place.x)} ${round(place.baseY)}) scale(${round(place.scale)})">` +
    `<g class="garden-sway" style="--garden-sway:${swayAmp}deg; animation-delay:${swayDelay}s">` +
    `<path class="garden-stem" d="M0 0 Q ${round(ctrlX)} ${round(ctrlY)} ${round(tipX)} ${round(tipY)}" ` +
    `style="stroke:var(${species.stemVar})" stroke-width="${stemWidth}" fill="none" stroke-linecap="round"/>` +
    foliageMarkup(species, height, lean, t) +
    `<g transform="translate(${round(tipX)} ${round(tipY)})">` +
    sproutMarkup(species, t) +
    bloomMarkup(species, t, height) +
    `</g>` +
    `</g></g>`
  );
}

/** Ground: a wavy soil band, plus a lip that buries the front row's feet. */
export function soilMarkup(width: number, topY: number): string {
  return (
    `<path class="garden-soil" d="M0 ${topY} Q ${round(width * 0.12)} ${topY - 9} ${round(width * 0.25)} ${topY - 2} ` +
    `T ${round(width * 0.5)} ${topY - 3} T ${round(width * 0.75)} ${topY - 1} T ${width} ${topY - 4} ` +
    `L ${width} 400 L 0 400 Z"/>` +
    // A slightly brighter line along the top edge gives the bed a horizon.
    `<path class="garden-soil-edge" d="M0 ${topY} Q ${round(width * 0.12)} ${topY - 9} ${round(width * 0.25)} ${topY - 2} ` +
    `T ${round(width * 0.5)} ${topY - 3} T ${round(width * 0.75)} ${topY - 1} T ${width} ${topY - 4}" fill="none"/>`
  );
}

export function soilLipMarkup(width: number, y: number): string {
  const pebbles: string[] = [];
  for (let i = 0; i < 14; i++) {
    const seed = hashUnit(`pebble-${i}`);
    const seed2 = hashUnit(`pebble-b-${i}`);
    const px = 20 + seed * (width - 40);
    const py = y + 6 + seed2 * 22;
    const r = 1.6 + seed2 * 2.6;
    pebbles.push(
      `<ellipse cx="${round(px)}" cy="${round(py)}" rx="${round(r)}" ry="${round(r * 0.62)}" ` +
        `style="fill:var(--garden-soil-speck)" opacity="${round(0.25 + seed * 0.4)}"/>`
    );
  }
  return (
    `<path class="garden-soil-lip" d="M0 ${y} Q ${round(width * 0.18)} ${y - 7} ${round(width * 0.36)} ${y - 2} ` +
    `T ${round(width * 0.7)} ${y - 4} T ${width} ${y - 1} L ${width} 400 L 0 400 Z"/>` +
    pebbles.join("")
  );
}

/** A few blades of grass behind the soil line, just for texture. */
export function grassMarkup(width: number, topY: number): string {
  const tufts: string[] = [];
  for (let i = 0; i < 7; i++) {
    const seed = hashUnit(`grass-${i}`);
    const gx = 30 + seed * (width - 60);
    const gy = topY - 2 - hashUnit(`grass-y-${i}`) * 8;
    const h = 9 + hashUnit(`grass-h-${i}`) * 7;
    tufts.push(
      `<g transform="translate(${round(gx)} ${round(gy)})" style="stroke:var(--garden-grass)" ` +
        `stroke-width="1.1" fill="none" stroke-linecap="round" opacity="0.5">` +
        `<path d="M0 0 q ${round(-h * 0.5)} ${round(-h)} ${round(-h * 0.7)} ${round(-h * 1.3)}"/>` +
        `<path d="M0 0 q 0 ${round(-h * 1.2)} ${round(h * 0.15)} ${round(-h * 1.5)}"/>` +
        `<path d="M0 0 q ${round(h * 0.5)} ${round(-h)} ${round(h * 0.75)} ${round(-h * 1.2)}"/>` +
        `</g>`
    );
  }
  return tufts.join("");
}
