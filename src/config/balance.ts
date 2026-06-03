// All tunable numbers live here so balance is one file, not scattered constants.

/** Simulation runs at a fixed timestep; render interpolates between sim states. */
export const SIM_HZ = 60;
export const FIXED_DT = 1 / SIM_HZ;

/** Player movement speed in world units per second (XZ plane). */
export const PLAYER_SPEED = 9;

/** Tilted follow-camera placement (the "Megabonk angle"). */
export const CAMERA_HEIGHT = 18; // units above the focus point
export const CAMERA_DISTANCE = 20; // units behind the focus point (+Z)
// → tilt ≈ atan(18/20) ≈ 42° from horizontal.

/** A run lasts at most 30 minutes (design decision). */
export const RUN_LENGTH_SEC = 30 * 60;
