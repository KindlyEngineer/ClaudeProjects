import { describe, it, expect } from "vitest";
import { PlayerView } from "../src/game/player";
import { cameraPosition, cameraTiltRadians } from "../src/render/camera";
import { CAMERA_HEIGHT, CAMERA_DISTANCE } from "../src/config/balance";

// Verifies render-adapter + camera math without a GPU. Three.js geometry/mesh
// construction needs no WebGL context, so this runs headlessly in Node.

describe("player view", () => {
  it("rests the capsule on the terrain surface", () => {
    const p = new PlayerView();
    p.sync(5, -3, 4);
    expect(p.mesh.position.x).toBeCloseTo(5, 6);
    expect(p.mesh.position.z).toBeCloseTo(-3, 6);
    // Capsule centre sits above the ground height, never sinking into it.
    expect(p.mesh.position.y).toBeGreaterThan(4);
  });
});

describe("follow camera", () => {
  it("sits above and behind the focus point", () => {
    const cam = cameraPosition(5, -3);
    expect(cam.x).toBe(5);
    expect(cam.y).toBe(CAMERA_HEIGHT);
    expect(cam.z).toBe(-3 + CAMERA_DISTANCE);
  });

  it("has a downward tilt between horizontal and vertical", () => {
    const tilt = cameraTiltRadians();
    expect(tilt).toBeGreaterThan(0);
    expect(tilt).toBeLessThan(Math.PI / 2);
  });
});
