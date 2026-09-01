/**
 * Theme-aware Click Audio Controller
 *   - dark / light: real mouse-click audio samples (click-down + click-up)
 *   - y2k-cyber: retro 8-bit synthesized blips
 *
 * Autoplay-policy safe: sounds are scheduled only after the AudioContext is
 * genuinely running, so the very first keystroke after a page reload (when
 * the cursor lands back in the terminal) is never swallowed by a suspended
 * context. Until the real samples finish loading, a small synth tick keeps
 * every interaction audible.
 */
export const ClickAudio = (() => {
  let audioCtx: AudioContext | null = null;
  let muted = localStorage.getItem("click-audio-muted") === "true";

  // Local mouse-click samples (bundled under src/data/audio, served at /data
  // — no dependency on the upstream host)
  const clickDownUrl = "/data/audio/mouse-click-down.mp3";
  const clickUpUrl = "/data/audio/mouse-click-up.mp3";
  const CACHE_NAME = "click-audio-samples-v2";
  let clickDownBuffer: AudioBuffer | null = null;
  let clickUpBuffer: AudioBuffer | null = null;
  let loadingSamples = false;

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

  /** Fetch one sample, preferring the Cache API so reloads are instant. */
  const loadSample = async (url: string): Promise<ArrayBuffer | null> => {
    try {
      if ("caches" in window) {
        const cache = await caches.open(CACHE_NAME);
        const hit = await cache.match(url);
        if (hit) return await hit.arrayBuffer();
      }
    } catch {
      // cache unavailable — fall through to network
    }
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.arrayBuffer();
      try {
        if ("caches" in window) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(
            url,
            new Response(data, { headers: { "Content-Type": "audio/mpeg" } })
          );
        }
      } catch {
        // caching failed — sample still works this session
      }
      return data;
    } catch {
      return null;
    }
  };

  /**
   * Preload both click samples into AudioBuffers. Retries on every interaction
   * until both are loaded, so a slow/failed first fetch self-heals instead of
   * leaving the page permanently silent.
   */
  const loadSamples = (): void => {
    if (loadingSamples || (clickDownBuffer && clickUpBuffer)) return;
    loadingSamples = true;
    initAudio();
    Promise.all([loadSample(clickDownUrl), loadSample(clickUpUrl)])
      .then(async ([down, up]) => {
        if (audioCtx) {
          try {
            if (down) clickDownBuffer = await audioCtx.decodeAudioData(down);
          } catch {
            /* undecodable — keep retrying */
          }
          try {
            if (up) clickUpBuffer = await audioCtx.decodeAudioData(up);
          } catch {
            /* undecodable — keep retrying */
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        loadingSamples = false;
      });
  };

  /** Tiny filtered-noise "tick" — keeps interactions audible pre-load. */
  const playTick = (volume: number, duration: number): void => {
    if (muted) return;
    void getRunningCtx().then((ctx) => {
      if (!ctx || muted) return;
      try {
        const rate = ctx.sampleRate;
        const len = Math.max(1, Math.floor(rate * duration));
        const buffer = ctx.createBuffer(1, len, rate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5);
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 4200; // the "snap" of a click
        filter.Q.value = 0.9;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start();
      } catch {
        // silent
      }
    });
  };

  /** Play a preloaded AudioBuffer through the running context. */
  const playBuffer = (buffer: AudioBuffer | null, volume: number = 1): void => {
    if (muted || !buffer) return;
    void getRunningCtx().then((ctx) => {
      if (!ctx || muted) return;
      try {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        if (volume === 1) {
          source.connect(ctx.destination);
        } else {
          const gain = ctx.createGain();
          gain.gain.value = volume;
          source.connect(gain);
          gain.connect(ctx.destination);
        }
        source.start();
      } catch {
        // silent
      }
    });
  };

  /** Synthesized tone (Y2K theme + fallback keystroke blips). */
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

  /** Play a click: real mouse samples for dark/light, synth blip for Y2K */
  const playClick = (): void => {
    const theme = getTheme();
    if (theme === "y2k-cyber") {
      // Retro square blip
      playTone(800, 0.06, "square", 0.08, 1200);
      return;
    }

    // Dark & Light — real mouse click-down followed by click-up. Until the
    // samples have loaded (fresh reload), a synth tick keeps every click
    // audible; once cached they are instant and replace it.
    loadSamples();
    if (clickDownBuffer) {
      playBuffer(clickDownBuffer);
    } else {
      playTick(0.9, 0.028);
    }
    setTimeout(() => {
      if (clickUpBuffer) {
        playBuffer(clickUpBuffer);
      } else {
        playTick(0.45, 0.012);
      }
    }, 60);
  };

  /** Keystroke tick (terminal typing) — always audible. */
  const playKeystroke = (): void => {
    const theme = getTheme();
    if (theme === "y2k-cyber") {
      playTone(1800, 0.015, "square", 0.04);
      return;
    }
    // Dark/Light: quiet version of the real down-sample once it's loaded,
    // otherwise a quiet synth tick — never dead silence after a reload.
    loadSamples();
    if (clickDownBuffer) {
      playBuffer(clickDownBuffer, 0.35);
    } else {
      playTick(0.35, 0.015);
    }
  };

  // Kick off sample loading as soon as any interaction happens (even one that
  // produces no sound itself), so real samples arrive quickly.
  if (typeof document !== "undefined") {
    const gestureLoad = (): void => loadSamples();
    document.addEventListener("pointerdown", gestureLoad, { passive: true });
    document.addEventListener("keydown", gestureLoad, { passive: true });
  }

  return {
    isMuted: (): boolean => muted,

    setMuted: (value: boolean): void => {
      muted = value;
      localStorage.setItem("click-audio-muted", String(value));
    },

    toggleMute: (): void => {
      ClickAudio.setMuted(!muted);
    },

    playClick,
    playKeystroke,
  };
})();
