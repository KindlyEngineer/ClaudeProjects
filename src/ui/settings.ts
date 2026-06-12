// Player settings (M4): tiny, persisted, applied globally. Animation speed
// feeds the tween scheduler; audio arrives with Horizon 2 (D14) and hangs its
// mute here; the player's CALL SIGN (the name the commanders address) follows
// the player across operations, not the save.

export interface Settings {
  animSpeed: 1 | 2.5 | 6; // tween-duration divisor: normal / fast / instant-ish
  audio: boolean;
  callSign: string; // the player's name on the net ("" = unnamed; dialogue stays neutral)
}

const KEY = "vantage.settings.v1";
const DEFAULTS: Settings = { animSpeed: 1, audio: true, callSign: "" };

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

/** The player's call sign, cleaned for the radio: trimmed, length-capped,
 *  empty when unset (dialogue then stays neutral — never "Hey, ''"). */
export function playerCallSign(): string {
  return getSettings().callSign.trim().slice(0, 16);
}
