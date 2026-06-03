import * as THREE from "three";
import { PLAYER_SPEED } from "../config/balance";
import { lerp } from "../core/math";

// The player. Sim state (x, z) lives on the XZ plane; the previous step's
// position is retained so rendering can interpolate for smooth motion.
//
// M0: flat ground, fixed height. Terrain-aware height comes in M2.

const CAPSULE_RADIUS = 0.5;
const CAPSULE_LENGTH = 1.0;
// Capsule total height = length + 2*radius = 2 → center sits at y=1 on flat ground.
const REST_Y = CAPSULE_LENGTH / 2 + CAPSULE_RADIUS;

export class Player {
  readonly mesh: THREE.Mesh;
  x = 0;
  z = 0;
  private prevX = 0;
  private prevZ = 0;

  constructor() {
    const geo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 6, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6cf0c2, roughness: 0.45, metalness: 0.0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.position.set(0, REST_Y, 0);
  }

  update(dt: number, move: { x: number; z: number }): void {
    this.prevX = this.x;
    this.prevZ = this.z;
    this.x += move.x * PLAYER_SPEED * dt;
    this.z += move.z * PLAYER_SPEED * dt;
  }

  /** Push interpolated sim state into the render transform. */
  syncRender(alpha: number): void {
    const ix = lerp(this.prevX, this.x, alpha);
    const iz = lerp(this.prevZ, this.z, alpha);
    this.mesh.position.set(ix, REST_Y, iz);
  }
}
