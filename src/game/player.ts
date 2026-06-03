import * as THREE from "three";
import { lerp } from "../core/math";

// Render view for the player: owns the capsule mesh and positions it from the
// Sim's player state, interpolating between the previous and current sim step
// for smooth motion. (Player movement itself lives in the Sim.)

const CAPSULE_RADIUS = 0.5;
const CAPSULE_LENGTH = 1.0;
// Capsule total height = length + 2*radius = 2 → center sits at y=1 on flat ground.
const REST_Y = CAPSULE_LENGTH / 2 + CAPSULE_RADIUS;

export class PlayerView {
  readonly mesh: THREE.Mesh;

  constructor() {
    const geo = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_LENGTH, 6, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6cf0c2, roughness: 0.45 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.position.set(0, REST_Y, 0);
  }

  /** Position the mesh at the interpolated player location. */
  sync(prevX: number, prevZ: number, curX: number, curZ: number, alpha: number): void {
    this.mesh.position.set(lerp(prevX, curX, alpha), REST_Y, lerp(prevZ, curZ, alpha));
  }
}
