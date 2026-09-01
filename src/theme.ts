import { Y2KAudioController } from "./services/y2k-audio";
import { ClickAudio } from "./services/click-audio";

const THEMES = ["light", "dark", "y2k-cyber"] as const;
type Theme = (typeof THEMES)[number];

function nextTheme(current: string): Theme {
  const idx = THEMES.indexOf(current as Theme);
  return THEMES[(idx + 1) % THEMES.length];
}

export function initTheme(): void {
  const selector = document.querySelector(".theme-selector") as HTMLElement | null;
  if (!selector) return;

  // Load saved theme or default to dark
  const saved = localStorage.getItem("theme") || "dark";
  const initial = THEMES.includes(saved as Theme) ? (saved as Theme) : "dark";
  setTheme(initial);

  // Initialize mute button state
  const muteBtn = document.querySelector(".y2k-mute-btn") as HTMLElement | null;
  if (muteBtn) {
    // Sync icon to saved mute state
    Y2KAudioController.setMuted(Y2KAudioController.isMuted());
    muteBtn.addEventListener("click", () => {
      Y2KAudioController.toggleMute();
      ClickAudio.toggleMute();
    });
  }

  // Clicking the whole selector cycles through themes
  selector.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const btn = target.closest(".theme-selector-btn") as HTMLElement | null;
    if (btn) {
      const choice = btn.dataset.themeChoice as Theme | undefined;
      if (choice && THEMES.includes(choice)) {
        setTheme(choice);
        return;
      }
    }
    const current = document.body.dataset.theme || "dark";
    setTheme(nextTheme(current));
  });

  // Mobile: single-button cycle toggle
  const mobileBtn = document.querySelector(".theme-selector-mobile") as HTMLElement | null;
  if (mobileBtn) {
    mobileBtn.addEventListener("click", () => {
      const current = document.body.dataset.theme || "dark";
      setTheme(nextTheme(current));
    });
  }
}

function setTheme(theme: Theme): void {
  const prevTheme = document.body.dataset.theme as Theme | undefined;
  document.body.dataset.theme = theme;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);

  // Play boot-up chime when switching to Y2K
  if (theme === "y2k-cyber" && prevTheme !== "y2k-cyber") {
    Y2KAudioController.playBootUp();
  }

  // Notify pages so they can re-render theme-dependent content (e.g. tag cloud)
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));

  // Update selector indicator position
  const selector = document.querySelector(".theme-selector") as HTMLElement | null;
  if (selector) {
    selector.dataset.active = theme;
  }

  // Update ARIA states
  document.querySelectorAll(".theme-selector-btn").forEach((btn) => {
    const el = btn as HTMLElement;
    const isActive = el.dataset.themeChoice === theme;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-checked", isActive ? "true" : "false");
  });

  // Update mobile toggle icon to match current theme
  const mobileBtn = document.querySelector(".theme-selector-mobile") as HTMLElement | null;
  if (mobileBtn) {
    const icons: Record<Theme, string> = {
      light: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
      dark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
      "y2k-cyber": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2c-1 0-2.5.5-3 2C4.5 6 3 8 3 11c0 3 1.5 5 3 6l1 5h10l1-5c1.5-1 3-3 3-6 0-3-1.5-5-3-7-.5-1.5-2-2-3-2z"/><circle cx="9" cy="11" r="1.5" fill="currentColor"/><circle cx="15" cy="11" r="1.5" fill="currentColor"/><path d="M10 15c.5.5 1.5.8 2 .8s1.5-.3 2-.8"/></svg>',
    };
    mobileBtn.innerHTML = icons[theme];
  }
}
