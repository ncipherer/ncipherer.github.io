/**
 * Y2K Cyber Retro Audio Controller
 * Synthesizes 8-bit sound effects using the native Web Audio API.
 * Respects a global mute toggle persisted in localStorage.
 */
export const Y2KAudioController = (() => {
  let audioCtx: AudioContext | null = null;
  let muted = localStorage.getItem("y2k-audio-muted") === "true";

  const initAudio = (): void => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  };

  const playTone = (
    startFreq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = "square"
  ): void => {
    if (muted) return;
    try {
      initAudio();
      if (!audioCtx) return;

      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);

      if (endFreq !== startFreq) {
        osc.frequency.exponentialRampToValueAtTime(
          endFreq,
          audioCtx.currentTime + duration
        );
      }

      gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.00001,
        audioCtx.currentTime + duration
      );

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (error) {
      // Silently fail — audio is enhancement only
    }
  };

  return {
    isMuted: (): boolean => muted,

    setMuted: (value: boolean): void => {
      muted = value;
      localStorage.setItem("y2k-audio-muted", String(value));
      // Update mute button icon
      const btn = document.querySelector(".y2k-mute-btn");
      if (btn) {
        btn.classList.toggle("muted", value);
        btn.setAttribute("aria-label", value ? "Unmute sounds" : "Mute sounds");
      }
    },

    toggleMute: (): void => {
      Y2KAudioController.setMuted(!muted);
    },

    /** Quick mechanical blip for button/link clicks */
    playClick: (): void => {
      playTone(800, 1200, 0.05, "square");
    },

    /** Micro digital tick for hover states */
    playHover: (): void => {
      playTone(1500, 1500, 0.01, "triangle");
    },

    /** Sci-fi swish for gallery slide transitions */
    playSlide: (): void => {
      playTone(400, 900, 0.12, "sawtooth");
    },

    /** Power-up chime when activating Y2K theme */
    playBootUp: (): void => {
      if (muted) return;
      initAudio();
      setTimeout(() => playTone(523.25, 523.25, 0.08, "square"), 0);
      setTimeout(() => playTone(659.25, 659.25, 0.08, "square"), 60);
      setTimeout(() => playTone(783.99, 783.99, 0.08, "square"), 120);
      setTimeout(
        () => playTone(1046.5, 1300.0, 0.2, "square"),
        180
      );
    },
  };
})();
