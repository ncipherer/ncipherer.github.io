/**
 * Theme-aware Click Audio Controller
 *   - y2k-cyber: retro 8-bit synthesized blips on clicks and keystrokes
 *   - dark / light: no UI click sound at all — the room keeps only the sounds
 *     that belong to it (the bioscope's wind and sprocket scrub, the player)
 *
 * Autoplay-policy safe: sounds are scheduled only after the AudioContext is
 * genuinely running, so the very first keystroke after a page reload (when
 * the cursor lands back in the terminal) is never swallowed by a suspended
 * context.
 */
export const ClickAudio = (() => {
  let audioCtx: AudioContext | null = null;
  // Touch devices start muted: the click layer is rarely wanted there, and
  // keystroke audio is skipped on coarse pointers anyway. Desktop keeps it on
  // — the per-theme sound is part of how the site feels. An explicit choice
  // always wins over the default.
  const storedMuted = localStorage.getItem("click-audio-muted");
  let muted =
    storedMuted === null
      ? window.matchMedia("(pointer: coarse)").matches
      : storedMuted === "true";

  /** Create the context (it starts suspended until a user gesture). */
  const initAudio = (): void => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
  };

  /**
   * Resolve to the context only once it is actually running. Scheduling audio
   * on a suspended context silently drops the sound, so every sound goes
   * through here first. The resume is triggered by the user gesture that is
   * currently being handled (click / tap / keydown).
   */
  const getRunningCtx = async (): Promise<AudioContext | null> => {
    initAudio();
    if (!audioCtx) return null;
    if (audioCtx.state === "running") return audioCtx;
    // A resolved resume() means the context is now running (it rejects on
    // failure), so scheduling can proceed safely.
    try {
      await audioCtx.resume();
      return audioCtx;
    } catch {
      return null;
    }
  };

  /** Synthesized tone — the Y2K theme's voice. */
  const playTone = (
    freq: number,
    duration: number,
    type: OscillatorType = "triangle",
    volume: number = 0.04,
    endFreq?: number
  ): void => {
    if (muted) return;
    void getRunningCtx().then((ctx) => {
      if (!ctx || muted) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        if (endFreq && endFreq !== freq) {
          osc.frequency.exponentialRampToValueAtTime(
            endFreq,
            ctx.currentTime + duration
          );
        }

        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(
          0.00001,
          ctx.currentTime + duration
        );

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + duration);
      } catch {
        // silent
      }
    });
  };

  const getTheme = (): string => {
    return document.body.dataset.theme || "dark";
  };

  /**
   * Play a click: an 8-bit blip under the Y2K theme, and nothing at all under
   * dark or light — a click that announces itself belongs to the arcade, not
   * to a quiet room. Every call site still calls this unconditionally, so the
   * whole click layer is gated in one place.
   */
  const playClick = (): void => {
    if (getTheme() !== "y2k-cyber") return;
    playTone(800, 0.06, "square", 0.08, 1200);
  };

  /** Keystroke tick (terminal typing) — the same rule: Y2K only. */
  const playKeystroke = (): void => {
    if (getTheme() !== "y2k-cyber") return;
    playTone(1800, 0.015, "square", 0.04);
  };

  // ── Film transport (screens page) ─────────────────────────────────
  // One shared burst of noise, reused by every sprocket tick, so winding
  // and scrubbing never allocate a buffer per sound.
  let noiseBuffer: AudioBuffer | null = null;
  const getNoiseBuffer = (ctx: AudioContext): AudioBuffer => {
    if (!noiseBuffer) {
      const len = Math.max(1, Math.floor(ctx.sampleRate * 0.05));
      noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return noiseBuffer;
  };

  /** One tooth of the ratchet: a tiny band-passed noise burst, the click
   *  of film passing a sprocket. Returns the node it scheduled, so a wind that
   *  gets cut short can silence the teeth it has already set up. */
  const playSprocket = (
    ctx: AudioContext,
    when: number,
    volume: number,
    freq: number,
  ): AudioScheduledSourceNode | null => {
    try {
      const src = ctx.createBufferSource();
      src.buffer = getNoiseBuffer(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = freq;
      filter.Q.value = 2.2;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, when);
      gain.gain.exponentialRampToValueAtTime(0.00001, when + 0.05);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(when);
      src.stop(when + 0.06);
      return src;
    } catch {
      // silent
      return null;
    }
  };

  /**
   * What the current wind has scheduled, and the generation it belongs to. A
   * wind is one shot aimed at a moment in the future: the reader clicking on
   * further down the reel does not want the sound of the wind they abandoned to
   * keep running while the film they asked for is already on the wall. So a new
   * wind — or a cut-short one — silences everything the old one left scheduled
   * and lets nothing more of it be scheduled.
   */
  let windToken = 0;
  let windNodes: AudioScheduledSourceNode[] = [];

  const stopWind = (): void => {
    windToken += 1; // anything still waiting for the context bails out
    const nodes = windNodes;
    windNodes = [];
    for (const node of nodes) {
      try {
        node.stop();
      } catch {
        // already stopped, or never started
      }
    }
  };

  const transportFreq = (): number =>
    getTheme() === "y2k-cyber" ? 3600 : 2400;

  /**
   * The reel turning: a ratchet of sprocket teeth with the body of the machine
   * humming under it, ending on the frame landing in the gate. `teeth` and
   * `durationMs` follow how far the film has to travel, so a long wind down the
   * reel is heard as a long wind — and it is deliberately the loudest thing on
   * the page after a click, because a wind nobody notices is a wind nobody
   * hears at all.
   */
  const playWind = (teeth: number = 3, durationMs: number = 420): void => {
    if (muted) return;
    // The machine only ever winds one way: a new wind takes over from whatever
    // the last one was still sounding.
    stopWind();
    const mine = windToken;
    void getRunningCtx().then((ctx) => {
      if (!ctx || muted || mine !== windToken) return;
      const freq = transportFreq();
      const neon = getTheme() === "y2k-cyber";
      const t0 = ctx.currentTime + 0.01;
      // the reels turn for as long as the wind takes, capped so a stray
      // enormous duration can never schedule a minute of noise
      const span = Math.max(0.14, Math.min(durationMs, 4000) / 1000);
      const count = Math.max(2, Math.min(40, Math.round(teeth)));
      // The ratchet has to end where the wind ends: the caller's duration is
      // the rack's travel, so the last tooth lands on the row the reader
      // asked for rather than a moment after the list has stopped.
      const end = Math.max(0.12, span - 0.05);
      const gap = end / (count + 1);
      for (let i = 0; i < count; i++) {
        // a tooth per frame travelled: hardest as the reel takes up the slack,
        // easing off as it winds down
        const t = i / Math.max(1, count - 1);
        const tooth = playSprocket(ctx, t0 + i * gap, 0.34 - 0.16 * t, freq * (1 + 0.02 * i));
        if (tooth) windNodes.push(tooth);
      }
      // and the last one is the frame arriving: a shade harder and lower than
      // the run of them, so the wind has a full stop instead of trailing off
      const landing = playSprocket(ctx, t0 + end, 0.36, freq * 0.92);
      if (landing) windNodes.push(landing);
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(neon ? 150 : 95, t0);
        osc.frequency.exponentialRampToValueAtTime(70, t0 + end);
        // the machine's own body: a low hum for as long as the reels turn,
        // gone by the time the rack has stopped
        gain.gain.setValueAtTime(0.00001, t0);
        gain.gain.linearRampToValueAtTime(0.09, t0 + span * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.00001, t0 + end + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + end + 0.07);
        windNodes.push(osc);
      } catch {
        // silent
      }
    });
  };

  /** Sprocket ticks for as long as the hand is scrubbing the reel.
   *  Goes quiet the moment mute flips; stops on stopScrub(). */
  let scrubTimer: number | null = null;
  const startScrub = (): void => {
    if (scrubTimer !== null || muted) return;
    scrubTimer = -1; // pending — the context is still waking up
    void getRunningCtx().then((ctx) => {
      if (!ctx || muted) {
        // No context (autoplay refused) — let the next gesture try again.
        if (scrubTimer === -1) scrubTimer = null;
        return;
      }
      if (scrubTimer === null) return; // stopped before it began
      const freq = transportFreq();
      const step = (): void => {
        if (muted || scrubTimer === null) return;
        playSprocket(ctx, ctx.currentTime + 0.005, 0.12, freq);
      };
      step();
      scrubTimer = window.setInterval(step, 120);
    });
  };

  const stopScrub = (): void => {
    if (scrubTimer !== null && scrubTimer >= 0) {
      window.clearInterval(scrubTimer);
    }
    scrubTimer = null;
  };

  return {
    isMuted: (): boolean => muted,

    setMuted: (value: boolean): void => {
      if (value === muted) return;
      muted = value;
      if (value) {
        stopScrub();
        stopWind();
      }
      localStorage.setItem("click-audio-muted", String(value));
      // One switch for the whole site: everyone who makes a sound listens for
      // this rather than being poked individually by whoever flipped it, so
      // the header speaker and the player bar can never disagree.
      document.dispatchEvent(
        new CustomEvent("site-mute-change", { detail: { muted: value } }),
      );
    },

    toggleMute: (): void => {
      ClickAudio.setMuted(!muted);
    },

    playClick,
    playKeystroke,
    playWind,
    stopWind,
    startScrub,
    stopScrub,
  };
})();
