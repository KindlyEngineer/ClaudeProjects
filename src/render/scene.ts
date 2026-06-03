import * as THREE from "three";
import { cameraPosition } from "./camera";

// Owns the Three.js renderer, scene, camera, lights and the (M0 flat) ground.
// The camera is a perspective tilt-follow cam — the angle that gives the 2.5D
// depth/parallax look. Heightmapped terrain replaces the flat ground in M2.

export interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
  followCamera: (x: number, z: number) => void;
  render: () => void;
}

const SKY = 0x0b0d12;

export function createView(container: HTMLElement): View {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 45, 130); // depth cueing

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

  // Lighting: cool ambient hemisphere + a warm key/sun that casts shadows.
  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x202a3a, 0.7));
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.15);
  sun.position.set(24, 40, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = 45;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  scene.add(sun.target);

  // Flat ground (placeholder until the M2 heightmap).
  const groundGeo = new THREE.PlaneGeometry(400, 400, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ color: 0x2a3346, roughness: 1.0 }),
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // Reference grid so motion/scale read clearly while there's no terrain yet.
  const grid = new THREE.GridHelper(400, 80, 0x3b4a66, 0x1c2536);
  const gmat = grid.material as THREE.Material;
  gmat.transparent = true;
  gmat.opacity = 0.5;
  grid.position.y = 0.01;
  scene.add(grid);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  const focus = new THREE.Vector3();
  const followCamera = (x: number, z: number) => {
    const p = cameraPosition(x, z);
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(focus.set(x, 0, z));
    sun.target.position.set(x, 0, z); // keep shadow frustum around the player
  };

  const render = () => renderer.render(scene, camera);

  return { renderer, scene, camera, resize, followCamera, render };
}
