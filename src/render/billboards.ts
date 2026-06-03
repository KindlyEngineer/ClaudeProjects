import * as THREE from "three";

// One InstancedMesh per sprite kind. Billboards live at true 3D positions but
// share the camera's orientation so they always face the viewer — the trick
// that gives 2D sprites real depth/parallax in the tilted 3D world. Thousands
// of instances update by writing a flat matrix buffer, no per-entity objects.

export class BillboardLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly size: number;
  private readonly q = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly mat = new THREE.Matrix4();
  private i = 0;

  constructor(texture: THREE.Texture, size: number, tint: number, capacity: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      color: tint,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.02,
    });
    this.mesh = new THREE.InstancedMesh(geo, material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.size = size;
  }

  /** Begin a frame: face all instances toward the camera. */
  begin(cameraQuaternion: THREE.Quaternion): void {
    this.i = 0;
    this.q.copy(cameraQuaternion);
    this.scale.setScalar(this.size);
  }

  push(x: number, y: number, z: number): void {
    if (this.i >= this.mesh.instanceMatrix.count) return;
    this.pos.set(x, y, z);
    this.mat.compose(this.pos, this.q, this.scale);
    this.mesh.setMatrixAt(this.i++, this.mat);
  }

  end(): void {
    this.mesh.count = this.i;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
