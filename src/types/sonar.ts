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
