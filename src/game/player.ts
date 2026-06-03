import * as THREE from "three";

// Render view for the player: owns the capsule mesh and positions it from the
// Sim's player state. (Player movement itself lives in the Sim; the caller
// interpolates XZ and samples the ground height.)

const CAPSULE_RADIUS = 0.5;
const CAPSULE_LENGTH = 1.0;
// Capsule total height = length + 2*radius = 2 → center sits REST_Y above ground.
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

  /** Place the capsule at (x, z) resting on a floor at height `groundY`. */
  sync(x: number, z: number, groundY: number): void {
    this.mesh.position.set(x, groundY + REST_Y, z);
  }
}
