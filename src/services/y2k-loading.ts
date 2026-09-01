/**
 * Y2K Retro Loading Overlay
 * Shows a dial-up style progress bar during page transitions.
 * Fast to 60%, then crawls to 100%.
 */
export function showY2KLoading(durationMs: number = 2500): void {
  const existing = document.getElementById("y2k-loading-overlay");
  if (existing) return;

  const TOTAL = 10;

  // Build the delay schedule proportionally to the given duration
  // Base pattern: fast early, slow late (dial-up feel)
  const baseDelays = [120, 120, 140, 160, 200, 260, 380, 480, 380, 260];
  const baseTotal = baseDelays.reduce((a, b) => a + b, 0);
  const scale = durationMs / baseTotal;
  const delays = baseDelays.map((d) => Math.round(d * scale));

  const overlay = document.createElement("div");
  overlay.id = "y2k-loading-overlay";
  overlay.innerHTML = `
    <div class="y2k-load-box">
      <div class="y2k-load-title">Loading...</div>
      <div class="y2k-load-dialup">[__________] 0%</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const dialup = overlay.querySelector(".y2k-load-dialup") as HTMLElement;
  const timers: number[] = [];
  let filled = 0;

  function scheduleNext(): void {
    if (filled >= TOTAL) return;
    const t = window.setTimeout(() => {
      filled++;
      const blocks = "\u25A0".repeat(filled) + "_".repeat(TOTAL - filled);
      const pct = Math.round((filled / TOTAL) * 100);
      dialup.textContent = `[${blocks}] ${pct}%`;
      scheduleNext();
    }, delays[filled]);
    timers.push(t);
  }
  scheduleNext();

  // Remove after full duration
  const totalTime = delays.reduce((a, b) => a + b, 0);
  const removeTimer = window.setTimeout(() => {
    timers.forEach(window.clearTimeout);
    overlay.classList.add("fade-out");
    setTimeout(() => overlay.remove(), 300);
  }, totalTime);
  timers.push(removeTimer);
}
