// Player settings (M4): tiny, persisted, applied globally. Animation speed
// feeds the tween scheduler; audio arrives with Horizon 2 (D14) and hangs its
// mute here.

export interface Settings {
  animSpeed: 1 | 2.5 | 6; // tween-duration divisor: normal / fast / instant-ish
  audio: boolean;
}

const KEY = "vantage.settings.v1";
const DEFAULTS: Settings = { animSpeed: 1, audio: true };

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;
  try {
    cached = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>) };
  } catch {
    cached = { ...DEFAULTS };
  }
  return cached;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cached = { ...getSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // private mode — the choice just doesn't stick
  }
  return cached;
}

export const ANIM_LABEL: Record<string, string> = { "1": "Normal", "2.5": "Fast", "6": "Instant" };
