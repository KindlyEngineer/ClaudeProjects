import { describe, it, expect } from "vitest";
import { Player } from "../src/game/player";
import { cameraPosition, cameraTiltRadians } from "../src/render/camera";
import { PLAYER_SPEED, CAMERA_HEIGHT, CAMERA_DISTANCE } from "../src/config/balance";

// Verifies the M0 simulation spine without a GPU: Three.js geometry/mesh
// construction needs no WebGL context, so player integration + the follow-cam
// math are fully testable in Node.

describe("player movement", () => {
  it("integrates velocity over time", () => {
    const p = new Player();
    const dt = 1 / 60;
    // Move straight along +X for 1 simulated second.
    for (let i = 0; i < 60; i++) p.update(dt, { x: 1, z: 0 });
    expect(p.x).toBeCloseTo(PLAYER_SPEED, 4);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it("does not move with zero input", () => {
    const p = new Player();
    for (let i = 0; i < 30; i++) p.update(1 / 60, { x: 0, z: 0 });
    expect(p.x).toBe(0);
    expect(p.z).toBe(0);
  });

  it("interpolates the render transform between sim steps", () => {
    const p = new Player();
    p.update(1, { x: 1, z: 0 }); // prev=0, current=PLAYER_SPEED
    p.syncRender(0.5);
    expect(p.mesh.position.x).toBeCloseTo(PLAYER_SPEED * 0.5, 4);
    // Capsule rests above ground, never sinks into it.
    expect(p.mesh.position.y).toBeGreaterThan(0);
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
