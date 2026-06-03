import { CAMERA_DISTANCE, CAMERA_HEIGHT } from "../config/balance";

// Pure camera-placement math for the tilted follow cam, separated from the
// Three.js scene so it can be unit-tested without a GPU/WebGL context.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** World-space camera position for a focus point. `focusY` offsets the whole
 *  rig vertically (0 on the flat arena floor). */
export function cameraPosition(focusX: number, focusZ: number, focusY = 0): Vec3 {
  return { x: focusX, y: focusY + CAMERA_HEIGHT, z: focusZ + CAMERA_DISTANCE };
}

/** Camera tilt below horizontal, in radians, derived from the placement. */
export function cameraTiltRadians(): number {
  return Math.atan2(CAMERA_HEIGHT, CAMERA_DISTANCE);
}
