/**
 * Site-wide Sonar Scroll UI
 *
 * The sonar scroll feature (Doppler-based hands-free scrolling) is a global
 * setting, just like the theme and the sound mute toggle: the navbar shows a
 * persistent mic button, the chosen state is persisted in localStorage, and
 * while the sonar is active a floating mic + signal meter are available on
 * every page (not only recipes).
 */
import { SonarService, BandwidthData } from "./sonar";
import { ClickAudio } from "./click-audio";

const STORAGE_KEY = "sonar-scroll-enabled";
const METER_BARS = 8;
const MAX_BAR_HEIGHT = 52;

export class SonarUIController {
  private static instance: SonarUIController | null = null;

  static getInstance(): SonarUIController {
    if (!SonarUIController.instance) {
      SonarUIController.instance = new SonarUIController();
    }
    return SonarUIController.instance;
  }

  private sonar: SonarService;
  private fab: HTMLButtonElement | null = null;
  private meter: HTMLDivElement | null = null;
  private bars: HTMLDivElement[] = [];
  private meterLabel: HTMLDivElement | null = null;
  private active = false;
  private started = false;

  private constructor() {
    this.sonar = SonarService.getInstance();

    const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (isMobile) this.sonar.configureForMobile();
  }

  isEnabled(): boolean {
    return this.active;
  }

  /**
   * Wire up the navbar toggle (called once at app start). Restores the
   * persisted setting into the button state — but never auto-starts the
   * microphone: browsers require a user gesture for audio + mic access, so
   * a saved "on" turns into "on at first click".
   */
  init(): void {
    const btn = document.querySelector(".sonar-toggle-btn") as HTMLButtonElement | null;
    if (!btn || this.started) return;
    this.started = true;

    // Click the icon → directly toggle sonar on/off
    btn.addEventListener("click", () => {
      ClickAudio.playClick();
      this.toggle();
    });

    // Info button → show info dialog
    const infoBtn = document.querySelector(".sonar-info-btn") as HTMLButtonElement | null;
    infoBtn?.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      ClickAudio.playClick();
      this.showInfo();
    });

    // Restore persisted preference into the button state.
    if (localStorage.getItem(STORAGE_KEY) === "true") {
      this.active = true;
      this.setBtnActive(btn, true);
    }

    // Keep the toggle honest if the sonar stops itself (denied permission,
    // unsupported device, ...).
    this.sonar.setCallbacks({
      onStateChange: (state) => {
        if (state === "calibrating") {
          btn.classList.add("calibrating");
          this.fab?.classList.add("calibrating");
          this.fab?.classList.remove("active");
          this.meter?.classList.add("visible");
        } else if (state === "active") {
          btn.classList.remove("calibrating");
          this.fab?.classList.remove("calibrating");
          this.fab?.classList.add("active");
          this.meter?.classList.add("visible");
        } else {
          btn.classList.remove("calibrating");
          this.stopUI();
        }
      },
      onDirectionChange: () => {
        ClickAudio.playClick();
      },
      onBandwidth: (data: BandwidthData) => this.updateMeter(data),
    });
  }

  /** Toggle the sonar on/off and persist the choice. */
  async toggle(): Promise<void> {
    if (this.sonar.getState() !== "idle" || (this.active && this.fab)) {
      // Currently on (or starting) — turn it off.
      this.active = false;
      localStorage.setItem(STORAGE_KEY, "false");
      this.sonar.stop(); // fires onStateChange -> stopUI()
      return;
    }

    if (!this.sonar.isSupported()) {
      console.warn("[Sonar] Not supported in this browser");
      return;
    }

    await this.startSonar();
  }

  private async startSonar(): Promise<void> {
    this.active = true;
    localStorage.setItem(STORAGE_KEY, "true");

    this.showFab();
    this.setBtnActive(this.getBtn(), true);
    await this.sonar.start();
  }

  /** Show the info dialog — available any time. */
  private showInfo(): void {
    const theme = document.body.dataset.theme || "dark";
    const isY2K = theme === "y2k-cyber";

    const overlay = document.createElement("div");
    overlay.className = "sonar-onboarding";
    overlay.innerHTML = `
      <div class="sonar-onboarding-backdrop"></div>
      <div class="sonar-onboarding-card${isY2K ? " y2k" : ""}">
        <div class="sonar-onboarding-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M7.76 16.24a6 6 0 0 1 0-8.49"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14"/></svg>
        </div>
        <h3 class="sonar-onboarding-title">Sonar Scroll</h3>
        <p class="sonar-onboarding-desc">
          Wave your hand in front of the mic to scroll this page — up or down.
          The site plays a high-frequency tone and listens for the Doppler
          shift your hand creates.
        </p>
        <ul class="sonar-onboarding-hints">
          <li><strong>Wave down</strong> to scroll down, <strong>wave up</strong> to scroll up</li>
          <li>Works on phones, tablets, and laptops — anywhere with a mic</li>
        </ul>
        <div class="sonar-onboarding-actions">
          <button class="sonar-onboarding-btn primary" data-action="close">Got it</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("visible"));

    const close = (): void => {
      overlay.classList.remove("visible");
      setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector("[data-action='close']")?.addEventListener("click", close);
    overlay.querySelector(".sonar-onboarding-backdrop")?.addEventListener("click", close);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        close();
        window.removeEventListener("keydown", onKey);
      }
    };
    window.addEventListener("keydown", onKey);
  }

  // ─── Internals ───────────────────────────────────────────────────────

  private getBtn(): HTMLButtonElement | null {
    return document.querySelector(".sonar-toggle-btn");
  }

  private setBtnActive(btn: HTMLButtonElement | null, active: boolean): void {
    if (!btn) return;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }

  /** Reset the FAB / meter / navbar visuals to the "off" state. */
  private stopUI(): void {
    this.fab?.remove();
    this.fab = null;
    this.meter?.remove();
    this.meter = null;
    this.bars = [];
    this.meterLabel = null;

    const btn = this.getBtn();
    this.setBtnActive(btn, false);
    btn?.classList.remove("calibrating");
  }

  /** Create the floating mic button + signal-strength meter (once). */
  private showFab(): void {
    if (this.fab && this.meter) return;

    const fab = document.createElement("button");
    fab.className = "sonar-fab";
    fab.setAttribute("aria-label", "Toggle sonar scroll");
    fab.title = "Sonar scroll — wave hand to scroll, double-tap to flip direction";
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
        <path d="M2 12h2" opacity=".4"/>
        <path d="M20 12h2" opacity=".4"/>
        <path d="M6.34 6.34l1.42 1.42" opacity=".4"/>
        <path d="M16.24 6.34l-1.42 1.42" opacity=".4"/>
      </svg>`;
    fab.addEventListener("click", () => this.toggle());
    document.body.appendChild(fab);
    this.fab = fab;

    const meter = document.createElement("div");
    meter.className = "sonar-meter";
    for (let i = 0; i < METER_BARS; i++) {
      const bar = document.createElement("div");
      bar.className = "sonar-meter-bar";
      bar.style.height = "3px";
      meter.appendChild(bar);
      this.bars.push(bar);
    }
    const meterLabel = document.createElement("div");
    meterLabel.className = "sonar-meter-label";
    meter.appendChild(meterLabel);
    document.body.appendChild(meter);
    this.meter = meter;
    this.meterLabel = meterLabel;
  }

  private updateMeter(data: BandwidthData): void {
    if (!this.meter || !this.meterLabel) return;
    const { diff } = data;
    const absDiff = Math.abs(diff);
    const intensity = Math.min(1, absDiff / 10);

    this.bars.forEach((bar, i) => {
      const stagger =
        1 - Math.abs(i - (METER_BARS - 1) / 2) / ((METER_BARS - 1) / 2);
      const height = Math.max(3, intensity * stagger * MAX_BAR_HEIGHT);
      bar.style.height = `${height}px`;

      bar.classList.toggle("active", intensity > 0.05);
      bar.classList.toggle("hot", intensity > 0.4);
      bar.classList.toggle("peak", intensity > 0.7);
    });

    if (intensity > 0.05) {
      const dir = diff > 0 ? "↓" : "↑";
      this.meterLabel.textContent = `${dir} ${diff.toFixed(1)}`;
    } else {
      this.meterLabel.textContent = "listening";
    }
  }
}
