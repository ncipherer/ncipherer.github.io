/**
 * Doppler Sonar Service
 *
 * Emits a high-frequency tone (~19–21 kHz, near the upper limit of human
 * hearing) and analyses the microphone input for asymmetric bandwidth
 * broadening caused by the Doppler effect on reflected sound.
 *
 * Approach based on DanielRapp/doppler and the SoundWave paper:
 * instead of tracking a noisy peak-frequency shift, we measure how far
 * the energy spreads to the left vs right of the emitted tone. A hand
 * moving toward the device compresses energy on one side; away expands
 * the other. The difference controls scroll direction and speed.
 *
 * Double-tap in the air (two quick bandwidth reversals) toggles the
 * scroll direction.
 */

export type ScrollDirection = "up" | "down";
export type SonarState = "idle" | "calibrating" | "active";

export interface BandwidthData {
  left: number;
  right: number;
  diff: number;
  primaryVolume: number;
  normalizedIntensity: number; // 0–1, how strong the signal is
}

export interface SonarCallbacks {
  onStateChange?: (state: SonarState) => void;
  onDirectionChange?: (direction: ScrollDirection) => void;
  onMotion?: (intensity: number, direction: ScrollDirection) => void;
  onBandwidth?: (data: BandwidthData) => void;
}

export class SonarService {
  private static instance: SonarService;

  // --- Configuration ---
  private readonly FREQ_START = 19000;
  private readonly FREQ_END = 21500;
  private readonly FFT_SIZE = 2048;
  private readonly SMOOTHING = 0.4;
  private readonly CALIBRATION_MS = 1500;
  private readonly POLL_INTERVAL_MS = 16; // ~60 Hz
  private readonly MAX_VOLUME_RATIO = 0.004;
  private readonly BANDWINDOW_LIMIT = 33;
  // Signal processing
  private DIFF_SMOOTHING = 0.35; // low-pass on centroid diff (lower = smoother)
  private DIFF_THRESHOLD = 1.5; // min smoothed |diff| to count as motion
  // Gesture detection
  private GESTURE_END_MS = 280; // ms of quiet to consider gesture finished
  private GESTURE_MIN_ENERGY = 12; // min accumulated |diff| sum before gesture counts (desktop)
  private SCROLL_AMOUNT_PX = 350; // fixed scroll per gesture (~1 recipe step)
  private SCROLL_ANIMATION_MS = 300; // smooth scroll duration
  // Direction toggle (double-tap)
  private readonly DOUBLE_TAP_WINDOW_MS = 450;
  private readonly REVERSAL_THRESHOLD = 4;

  // --- State ---
  private ctx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private osc: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private audioData: Uint8Array<ArrayBuffer> | null = null;
  private running = false;
  private mobileMode = false;
  private pollTimer = 0;
  private state: SonarState = "idle";
  private freq = 20000;
  private direction: ScrollDirection = "down";
  private callbacks: SonarCallbacks = {};

  // Signal processing state
  private smoothedDiff = 0;
  // Gesture tracking
  private gestureActive = false;
  private gestureEnergyUp = 0;   // accumulated negative diff (hand going up)
  private gestureEnergyDown = 0; // accumulated positive diff (hand going down)
  private gestureEndTimer = 0;

  // Double-tap detection
  private lastReversalAt = 0;
  private reversalCount = 0;
  private lastBandDiff = 0;

  static getInstance(): SonarService {
    if (!SonarService.instance) {
      SonarService.instance = new SonarService();
    }
    return SonarService.instance;
  }

  // ─── Public API ────────────────────────────────────────────────────

  isSupported(): boolean {
    return (
      !!(window.AudioContext || (window as any).webkitAudioContext) &&
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
    );
  }

  getState(): SonarState {
    return this.state;
  }

  getDirection(): ScrollDirection {
    return this.direction;
  }

  /**
   * Tune thresholds for mobile: weaker speakers, mics with tighter
   * low-pass filters. Call before start().
   */
  configureForMobile(): void {
    this.mobileMode = true;
    this.DIFF_THRESHOLD = 1.0;      // catch weaker signals
    this.GESTURE_END_MS = 320;      // slightly longer window for slower mobile polling
    this.GESTURE_MIN_ENERGY = 6;   // lower energy threshold for weaker mobile mics
    this.SCROLL_AMOUNT_PX = 300;    // slightly less scroll per gesture (smaller screen)
  }

  setCallbacks(cbs: SonarCallbacks): void {
    this.callbacks = cbs;
  }

  /** Start sonar: initialise context, optimise frequency, begin analysis. */
  async start(): Promise<void> {
    if (this.running) return;

    if (!this.isSupported()) {
      console.warn("[Sonar] AudioContext or getUserMedia not supported");
      return;
    }

    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();

      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }

      this.setState("calibrating");

      // --- Emit Doppler tone ---
      this.osc = this.ctx.createOscillator();
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = this.mobileMode ? 0.35 : 0.15;
      this.osc.type = "sine";
      this.osc.frequency.value = this.freq;
      this.osc.connect(this.gainNode);
      this.gainNode.connect(this.ctx.destination);
      this.osc.start();

      // --- Microphone input (critical: echoCancellation must be off) ---
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as any,
      });

      const micSource = this.ctx.createMediaStreamSource(this.micStream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.FFT_SIZE;
      this.analyser.smoothingTimeConstant = this.SMOOTHING;
      micSource.connect(this.analyser);
      this.audioData = new Uint8Array(this.analyser.frequencyBinCount);

      // --- Optimise frequency (find the tone the mic picks up best) ---
      this.freq = this.optimiseFrequency();
      this.osc.frequency.value = this.freq;

      // Brief pause for calibration settling
      await this.sleep(this.CALIBRATION_MS);

      this.running = true;
      this.setState("active");
      this.pollMic();
    } catch (err) {
      console.error("[Sonar] Failed to start:", err);
      this.stop();
    }
  }

  /** Stop sonar and release all audio resources. */
  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = 0;
    }
    clearTimeout(this.gestureEndTimer);
    this.gestureActive = false;
    this.gestureEnergyUp = 0;
    this.gestureEnergyDown = 0;
    this.smoothedDiff = 0;

    try {
      this.osc?.stop();
    } catch {
      /* already stopped */
    }
    this.osc?.disconnect();
    this.osc = null;

    this.gainNode?.disconnect();
    this.gainNode = null;

    this.analyser?.disconnect();
    this.analyser = null;

    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;

    try {
      this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.audioData = null;

    this.setState("idle");
  }

  /** Toggle between scroll-up and scroll-down (double-tap does this too). */
  toggleDirection(): void {
    this.direction = this.direction === "down" ? "up" : "down";
    this.callbacks.onDirectionChange?.(this.direction);
  }

  // ─── Internal: frequency optimisation ──────────────────────────────

  /**
   * Sweep the 19–21.5 kHz range and find the frequency that produces the
   * strongest reading in the analyser — the "sweet spot" for this device's
   * speaker + mic combination.
   */
  private optimiseFrequency(): number {
    if (!this.analyser || !this.osc) return this.freq;

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const nyquist = this.ctx!.sampleRate / 2;
    const binSize = nyquist / (this.FFT_SIZE / 2);
    const fromBin = Math.floor(this.FREQ_START / binSize);
    const toBin = Math.ceil(this.FREQ_END / binSize);

    let maxAmp = 0;
    let maxBin = Math.round(this.freq / binSize);

    for (let i = fromBin; i <= toBin && i < data.length; i++) {
      this.osc.frequency.value = i * binSize;
      this.analyser.getByteFrequencyData(data);
      if (data[i] > maxAmp) {
        maxAmp = data[i];
        maxBin = i;
      }
    }

    return maxAmp > 0 ? maxBin * binSize : this.freq;
  }

  // ─── Internal: microphone polling loop ─────────────────────────────

  private pollMic(): void {
    if (!this.running || !this.analyser || !this.audioData) return;

    this.analyser.getByteFrequencyData(this.audioData);

    // Weighted centroid diff — much more stable than raw bin counts
    const rawDiff = this.getDiffCentroid(this.audioData);

    // Low-pass filter: exponential smoothing kills rapid sign flips from noise
    this.smoothedDiff =
      this.smoothedDiff * (1 - this.DIFF_SMOOTHING) + rawDiff * this.DIFF_SMOOTHING;
    const diff = this.smoothedDiff;
    const absDiff = Math.abs(diff);
    const now = performance.now();

    // --- Gesture detection (vote-based, fires once per swipe) ---
    if (absDiff > this.DIFF_THRESHOLD) {
      if (!this.gestureActive) {
        this.gestureActive = true;
        this.gestureEnergyUp = 0;
        this.gestureEnergyDown = 0;
      }
      // Accumulate energy: brief but strong waves carry more weight than noise
      if (diff > 0) this.gestureEnergyDown += absDiff;
      else this.gestureEnergyUp += absDiff;

      clearTimeout(this.gestureEndTimer);
      this.gestureEndTimer = window.setTimeout(
        () => this.finishGesture(),
        this.GESTURE_END_MS,
      );
    }

    // --- Double-tap detection ---
    if (
      absDiff > this.REVERSAL_THRESHOLD &&
      this.lastBandDiff !== 0 &&
      Math.sign(diff) !== Math.sign(this.lastBandDiff) &&
      now - this.lastReversalAt < this.DOUBLE_TAP_WINDOW_MS
    ) {
      this.reversalCount++;
      if (this.reversalCount >= 2) {
        this.toggleDirection();
        this.hapticFeedback();
        this.reversalCount = 0;
      }
    } else if (absDiff > this.REVERSAL_THRESHOLD) {
      this.reversalCount = 1;
    }
    this.lastReversalAt = now;
    this.lastBandDiff = diff;

    // --- Bandwidth data for visualizer ---
    const primaryBin = Math.round(
      (this.freq / this.ctx!.sampleRate / 2) * (this.FFT_SIZE / 2),
    );
    const primaryVol = this.audioData[primaryBin] || 0;
    this.callbacks.onBandwidth?.({
      left: 0,
      right: 0,
      diff: this.smoothedDiff,
      primaryVolume: primaryVol,
      normalizedIntensity: Math.min(1, absDiff / 10),
    });

    this.pollTimer = window.setTimeout(
      () => this.pollMic(),
      this.POLL_INTERVAL_MS,
    );
  }

  /**
   * Called when a gesture ends (no motion for GESTURE_END_MS).
   * Counts votes and scrolls in the dominant direction by a fixed amount.
   */
  private finishGesture(): void {
    if (!this.gestureActive) return;
    this.gestureActive = false;

    // Energy-based decision: compare accumulated signal energy per direction.
    // A brief but strong hand wave produces more energy than scattered noise.
    const totalEnergy = this.gestureEnergyUp + this.gestureEnergyDown;
    if (totalEnergy < this.GESTURE_MIN_ENERGY) return; // too little motion — noise

    // Require the winning direction to hold at least 60% of total energy.
    // This prevents ambiguous gestures (e.g. shaking) from scrolling.
    const ratio = Math.max(this.gestureEnergyDown, this.gestureEnergyUp) / totalEnergy;
    if (ratio < 0.6) return; // too ambiguous — no clear winner

    const gestureDir: ScrollDirection =
      this.gestureEnergyDown > this.gestureEnergyUp ? "down" : "up";

    const finalDir = this.direction === "up"
      ? (gestureDir === "down" ? "up" : "down")
      : gestureDir;

    this.smoothScrollBy(finalDir === "down" ? this.SCROLL_AMOUNT_PX : -this.SCROLL_AMOUNT_PX);
    this.callbacks.onMotion?.(this.SCROLL_AMOUNT_PX, finalDir);
  }

  /**
   * Animate a scroll by `px` pixels over SCROLL_ANIMATION_MS.
   * Uses requestAnimationFrame for smooth 60fps easing.
   */
  private smoothScrollBy(px: number): void {
    const start = performance.now();
    const startY = window.scrollY;
    const targetY = startY + px;
    const duration = this.SCROLL_ANIMATION_MS;

    const ease = (t: number): number => t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease-in-out cubic

    const tick = (now: number): void => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const y = startY + (targetY - startY) * ease(progress);
      window.scrollTo(0, y);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ─── Internal: bandwidth measurement (SoundWave approach) ──────────

  /**
   * Measure how far the Doppler energy spreads left and right of the
   * primary tone bin. Asymmetric spreading indicates motion direction.
   */
  /**
   * Compute the weighted centroid of energy on each side of the primary
   * tone, then return the difference (right centroid − left centroid).
   * Positive = energy shifted higher (toward mic), negative = lower (away).
   *
   * Much more stable than raw bin counts because amplitude weighting
   * suppresses noise at the band edges.
   */
  private getDiffCentroid(data: Uint8Array): number {
    if (!this.analyser) return 0;

    const nyquist = this.ctx!.sampleRate / 2;
    const primaryBin = Math.round(
      (this.freq / nyquist) * (this.FFT_SIZE / 2),
    );
    const primaryVol = data[primaryBin];
    if (primaryVol === 0) return 0;

    // Scan left: compute amplitude-weighted centroid
    let leftSum = 0;
    let leftWeight = 0;
    for (let i = 1; i <= this.BANDWINDOW_LIMIT; i++) {
      const bin = primaryBin - i;
      if (bin < 0) break;
      const vol = data[bin] / primaryVol;
      if (vol <= this.MAX_VOLUME_RATIO) break;
      leftSum += i * vol;
      leftWeight += vol;
    }
    const leftCentroid = leftWeight > 0 ? leftSum / leftWeight : 0;

    // Scan right: compute amplitude-weighted centroid
    let rightSum = 0;
    let rightWeight = 0;
    for (let i = 1; i <= this.BANDWINDOW_LIMIT; i++) {
      const bin = primaryBin + i;
      if (bin >= data.length) break;
      const vol = data[bin] / primaryVol;
      if (vol <= this.MAX_VOLUME_RATIO) break;
      rightSum += i * vol;
      rightWeight += vol;
    }
    const rightCentroid = rightWeight > 0 ? rightSum / rightWeight : 0;

    return rightCentroid - leftCentroid;
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private setState(s: SonarState): void {
    if (this.state === s) return;
    this.state = s;
    this.callbacks.onStateChange?.(s);
  }

  private hapticFeedback(): void {
    try {
      navigator.vibrate?.([15, 40, 15]);
    } catch {
      /* no vibration support */
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
