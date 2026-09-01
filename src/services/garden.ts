/**
 * The garden.
 *
 * The only thing this site measures about a visitor is time: seconds they
 * actually spend with a page in front of them, summed across every session in
 * localStorage. That running total is what grows the garden on the homepage —
 * each flower has its own bloom time, and nothing ever wilts, so the longer
 * someone reads the fuller the garden gets.
 */

/* Accumulated seconds spent on the site (all sessions). */
const TOTAL_KEY = "garden-seconds";
/* Timestamp of the very first visit, so the garden can say when it was planted. */
const STARTED_KEY = "garden-started-at";

const TICK_MS = 1000;
/**
 * Most seconds credited by a single tick. A sleeping laptop or a throttled
 * background tab can produce a huge delta; that time wasn't spent reading, so
 * only the last moment counts.
 */
const MAX_TICK_SECONDS = 2;
/** How often the in-memory total is written back to localStorage. */
const FLUSH_MS = 5000;

export type FlowerStage = {
  /** Fraction of the flower's bloom time at which this stage begins. */
  at: number;
  label: string;
};

/**
 * The stages a flower passes through on its way to full bloom — the ones from
 * the camellia timeline, with the last chapters (petals falling, spent)
 * removed. Here the story only ever goes one way: forward into bloom.
 */
export const FLOWER_STAGES: FlowerStage[] = [
  { at: 0.0, label: "Seed in the soil" },
  { at: 0.06, label: "Sprouting" },
  { at: 0.16, label: "Leafing" },
  { at: 0.3, label: "Dormant bud" },
  { at: 0.44, label: "Tight bud" },
  { at: 0.56, label: "Bud cracking" },
  { at: 0.68, label: "Petals loosening" },
  { at: 0.8, label: "Unfurling" },
  { at: 0.92, label: "Petals relaxed" },
];

/** How a stem carries its leaves. */
export type Foliage = "camellia" | "broad" | "slender" | "feathery";

export type FlowerSpecies = {
  id: string;
  name: string;
  /** Seconds of accumulated site time this flower needs to reach full bloom. */
  bloomSeconds: number;
  /** One line about the flower, shown on hover. */
  whisper: string;
  /** Petals in one ring. */
  petals: number;
  /** Concentric petal rings; more rings = fuller, camellia-like bloom. */
  layers: number;
  /** Petal width as a fraction of petal length (0.4 slim, 0.8 round). */
  petalShape: number;
  /** Stem height at full bloom, in scene units. */
  height: number;
  /** Sideways drift of the stem, as a fraction of its height. */
  lean: number;
  /** Radius of the open bloom, in scene units. */
  bloomRadius: number;
  foliage: Foliage;
  /** CSS custom properties the SVG paints with, so themes can recolour it. */
  petalVar: string;
  petalDeepVar: string;
  centerVar: string;
  stemVar: string;
  leafVar: string;
};

const GREEN_STEM = "--garden-stem";
const WOODY_STEM = "--garden-stem-woody";
const LEAF = "--garden-leaf";
const GOLD = "--garden-center-gold";

/**
 * Flowers, in the order the garden plants them. Bloom times deliberately
 * spread out — the first opens inside a minute, the last asks for a couple of
 * days of reading — and the three camellias open hours apart from each other.
 */
export const FLOWERS: FlowerSpecies[] = [
  {
    id: "daisy",
    name: "Oxeye daisy",
    bloomSeconds: 60,
    whisper: "The first flower. It opens for anyone who stays a minute.",
    petals: 12,
    layers: 1,
    petalShape: 0.62,
    height: 96,
    lean: 0.05,
    bloomRadius: 15,
    foliage: "slender",
    petalVar: "--garden-daisy",
    petalDeepVar: "--garden-daisy-deep",
    centerVar: GOLD,
    stemVar: GREEN_STEM,
    leafVar: LEAF,
  },
  {
    id: "morning-glory",
    name: "Morning glory",
    bloomSeconds: 300,
    whisper: "Winds itself around whatever is nearby, and opens before you notice.",
    petals: 5,
    layers: 1,
    petalShape: 0.74,
    height: 118,
    lean: 0.2,
    bloomRadius: 21,
    foliage: "feathery",
    petalVar: "--garden-morning-glory",
    petalDeepVar: "--garden-morning-glory-deep",
    centerVar: "--garden-center-light",
    stemVar: GREEN_STEM,
    leafVar: LEAF,
  },
  {
    id: "poppy",
    name: "Corn poppy",
    bloomSeconds: 720,
    whisper: "Thin, impossible petals — the kind that only last a few days.",
    petals: 5,
    layers: 1,
    petalShape: 0.78,
    height: 110,
    lean: 0.09,
    bloomRadius: 23,
    foliage: "slender",
    petalVar: "--garden-poppy",
    petalDeepVar: "--garden-poppy-deep",
    centerVar: "--garden-center-dark",
    stemVar: GREEN_STEM,
    leafVar: LEAF,
  },
  {
    id: "iris",
    name: "Bearded iris",
    bloomSeconds: 1500,
    whisper: "Three petals up, three down. Never quite symmetrical, always deliberate.",
    petals: 6,
    layers: 2,
    petalShape: 0.52,
    height: 124,
    lean: 0.1,
    bloomRadius: 18,
    foliage: "slender",
    petalVar: "--garden-iris",
    petalDeepVar: "--garden-iris-deep",
    centerVar: GOLD,
    stemVar: GREEN_STEM,
    leafVar: LEAF,
  },
  {
    id: "chrysanthemum",
    name: "Chrysanthemum",
    bloomSeconds: 2700,
    whisper: "Hundreds of narrow petals, folding outward one layer at a time.",
    petals: 26,
    layers: 3,
    petalShape: 0.6,
    height: 106,
    lean: 0.04,
    bloomRadius: 21,
    foliage: "broad",
    petalVar: "--garden-chrys",
    petalDeepVar: "--garden-chrys-deep",
    centerVar: "--garden-center-gold-deep",
    stemVar: GREEN_STEM,
    leafVar: LEAF,
  },
  {
    id: "plum",
    name: "Plum blossom",
    bloomSeconds: 4500,
    whisper: "Blooms on bare wood, in the cold, before the leaves believe it.",
    petals: 5,
    layers: 1,
    petalShape: 0.68,
    height: 120,
    lean: 0.28,
    bloomRadius: 15,
    foliage: "broad",
    petalVar: "--garden-plum",
    petalDeepVar: "--garden-plum-deep",
    centerVar: GOLD,
    stemVar: WOODY_STEM,
    leafVar: LEAF,
  },
  {
    id: "lotus",
    name: "Lotus",
    bloomSeconds: 7200,
    whisper: "Opens above the water and stays open. Nothing about it is in a hurry.",
    petals: 16,
    layers: 2,
    petalShape: 0.7,
    height: 128,
    lean: 0.02,
    bloomRadius: 25,
    foliage: "broad",
    petalVar: "--garden-lotus",
    petalDeepVar: "--garden-lotus-deep",
    centerVar: GOLD,
    stemVar: GREEN_STEM,
    leafVar: LEAF,
  },
  {
    id: "camellia",
    name: "Camellia",
    bloomSeconds: 10800,
    whisper: "Inner strength. It holds its bud for weeks, then gives you everything.",
    petals: 20,
    layers: 3,
    petalShape: 0.66,
    height: 140,
    lean: 0.03,
    bloomRadius: 26,
    foliage: "camellia",
    petalVar: "--garden-camellia",
    petalDeepVar: "--garden-camellia-deep",
    centerVar: GOLD,
    stemVar: WOODY_STEM,
    leafVar: "--garden-leaf-dark",
  },
  {
    id: "camellia-alba",
    name: "Camellia alba",
    bloomSeconds: 18000,
    whisper: "The white one. Same patience, quieter about it.",
    petals: 24,
    layers: 3,
    petalShape: 0.68,
    height: 148,
    lean: 0.05,
    bloomRadius: 27,
    foliage: "camellia",
    petalVar: "--garden-camellia-alba",
    petalDeepVar: "--garden-camellia-alba-deep",
    centerVar: GOLD,
    stemVar: WOODY_STEM,
    leafVar: "--garden-leaf-dark",
  },
  {
    id: "camellia-red",
    name: "Camellia japonica",
    bloomSeconds: 28800,
    whisper: "Deep red, twenty-eight petals, and not one of them in a rush.",
    petals: 30,
    layers: 4,
    petalShape: 0.7,
    height: 156,
    lean: 0.04,
    bloomRadius: 28,
    foliage: "camellia",
    petalVar: "--garden-camellia-red",
    petalDeepVar: "--garden-camellia-red-deep",
    centerVar: GOLD,
    stemVar: WOODY_STEM,
    leafVar: "--garden-leaf-dark",
  },
  {
    id: "peony",
    name: "Tree peony",
    bloomSeconds: 43200,
    whisper: "So heavy when it opens that the whole stem leans with it.",
    petals: 26,
    layers: 3,
    petalShape: 0.76,
    height: 146,
    lean: 0.06,
    bloomRadius: 30,
    foliage: "broad",
    petalVar: "--garden-peony",
    petalDeepVar: "--garden-peony-deep",
    centerVar: "--garden-center-dark",
    stemVar: WOODY_STEM,
    leafVar: LEAF,
  },
  {
    id: "wisteria",
    name: "Wisteria",
    bloomSeconds: 72000,
    whisper: "Climbs for years and then hangs its flowers straight down.",
    petals: 18,
    layers: 3,
    petalShape: 0.6,
    height: 162,
    lean: 0.16,
    bloomRadius: 22,
    foliage: "feathery",
    petalVar: "--garden-wisteria",
    petalDeepVar: "--garden-wisteria-deep",
    centerVar: GOLD,
    stemVar: WOODY_STEM,
    leafVar: LEAF,
  },
  {
    id: "moonflower",
    name: "Moonflower",
    bloomSeconds: 108000,
    whisper: "Reserved for whoever keeps coming back. It only opens for the patient.",
    petals: 5,
    layers: 1,
    petalShape: 0.8,
    height: 168,
    lean: 0.1,
    bloomRadius: 30,
    foliage: "broad",
    petalVar: "--garden-moonflower",
    petalDeepVar: "--garden-moonflower-deep",
    centerVar: GOLD,
    stemVar: GREEN_STEM,
    leafVar: LEAF,
  },
];

export type GardenState = {
  /** Seconds spent on the site across every session. */
  totalSeconds: number;
  /** Seconds spent in this visit. */
  sessionSeconds: number;
  /** When the garden was planted, or null if this is the first visit. */
  startedAt: number | null;
};

type Listener = (state: GardenState) => void;

/** localStorage reads must never take the site down (private mode, quota). */
function readSeconds(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function writeSeconds(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(Math.floor(value)));
  } catch {
    /* quota exceeded — the clock keeps running for this visit */
  }
}

/** How far along a flower is, 0 (seed) → 1 (fully open). Never decays. */
export function flowerProgress(species: FlowerSpecies, totalSeconds: number): number {
  const progress = totalSeconds / species.bloomSeconds;
  return progress < 0 ? 0 : progress > 1 ? 1 : progress;
}

/** The stage a flower at this progress has reached. */
export function stageOf(progress: number): FlowerStage {
  let current = FLOWER_STAGES[0];
  for (const stage of FLOWER_STAGES) {
    if (progress >= stage.at) current = stage;
    else break;
  }
  return current;
}

/** Seconds still needed before this flower opens (0 once it has). */
export function secondsUntilBloom(species: FlowerSpecies, totalSeconds: number): number {
  return Math.max(0, species.bloomSeconds - Math.floor(totalSeconds));
}

/**
 * A span of time in coarse human units: "3d 4h", "1h 12m", "45s". Used for
 * both countdowns ("2h 23m to bloom") and clock stamps ("full bloom at 3h").
 */
export function formatSpan(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) {
    const rest = total % 60;
    return rest >= 30 ? `${minutes}m ${rest}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** The headline clock: always ticking, even in the second minute. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(rest)}s`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(rest)}s`;
  return `${minutes}m ${pad(rest)}s`;
}

/**
 * Counts time spent with the site in front of the visitor and persists it
 * across sessions. Lives site-wide (every route ticks the same clock), while
 * the garden that visualises it lives on the homepage.
 */
export class GardenService {
  private static instance: GardenService | null = null;

  static getInstance(): GardenService {
    if (!GardenService.instance) {
      GardenService.instance = new GardenService();
    }
    return GardenService.instance;
  }

  private total: number;
  private session = 0;
  /** Fractional seconds not yet banked into `total`. */
  private pending = 0;
  private lastSample: number;
  private lastFlush: number;
  private timer: number | null = null;
  private startedAt: number | null;
  private listeners = new Set<Listener>();

  private constructor() {
    this.total = readSeconds(TOTAL_KEY);
    this.startedAt = readSeconds(STARTED_KEY) || null;
    this.lastSample = performance.now();
    this.lastFlush = this.lastSample;
  }

  /** Begin counting. Safe to call from every page render — it only starts once. */
  init(): void {
    if (this.timer !== null) return;
    this.lastSample = performance.now();
    this.lastFlush = this.lastSample;
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("pagehide", this.handlePageHide);
    this.timer = window.setInterval(this.tick, TICK_MS);
  }

  destroy(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("pagehide", this.handlePageHide);
    this.flush();
  }

  getState(): GardenState {
    return {
      totalSeconds: this.total,
      sessionSeconds: this.session,
      startedAt: this.startedAt,
    };
  }

  getTotalSeconds(): number {
    return this.total;
  }

  getSessionSeconds(): number {
    return this.session;
  }

  getStartedAt(): number | null {
    return this.startedAt;
  }

  /** Subscribe to per-second updates. Returns an unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Uproot everything: the visitor asked to start over. */
  reset(): void {
    this.total = 0;
    this.session = 0;
    this.pending = 0;
    this.startedAt = Date.now();
    try {
      localStorage.removeItem(TOTAL_KEY);
      localStorage.setItem(STARTED_KEY, String(this.startedAt));
    } catch {
      /* ignore */
    }
    this.lastFlush = performance.now();
    this.emit();
  }

  private tick = (): void => {
    const now = performance.now();
    const delta = (now - this.lastSample) / 1000;
    this.lastSample = now;

    if (document.visibilityState === "visible" && delta > 0) {
      const credited = Math.min(delta, MAX_TICK_SECONDS);
      this.pending += credited;
      this.session += credited;
    }

    const whole = Math.floor(this.pending);
    if (whole >= 1) {
      this.total += whole;
      this.pending -= whole;
      if (this.startedAt === null) {
        this.startedAt = Date.now();
        writeSeconds(STARTED_KEY, this.startedAt);
      }
    }

    if (now - this.lastFlush >= FLUSH_MS) this.flush();
    this.emit();
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === "visible") {
      // Another tab may have banked time while this one slept — pick it up,
      // and ignore the gap so the pause isn't credited twice.
      this.total = Math.max(this.total, readSeconds(TOTAL_KEY));
    } else {
      this.flush();
    }
    this.lastSample = performance.now();
  };

  private handlePageHide = (): void => {
    this.flush();
  };

  private flush(): void {
    this.lastFlush = performance.now();
    writeSeconds(TOTAL_KEY, this.total);
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
