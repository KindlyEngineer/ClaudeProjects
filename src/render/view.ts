import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Owns the renderer, scene, camera, lights and camera CONTROLS. The camera is a
// tilted tactics-board view framed to fit the map, with right-drag panning and
// wheel zoom (zoom-to-cursor); left mouse stays free for the command gestures.
// Soft shadows ground the units against the heightmap. Render only reads sim
// state; this module knows nothing about game rules.

export interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
  /** Point the tilted camera so the given world-space box fills the frame. */
  frame: (min: THREE.Vector3, max: THREE.Vector3) => void;
  /** Per-frame upkeep (control damping). */
  tick: () => void;
  render: () => void;
  dispose: () => void;
}

export function createView(container: HTMLElement): View {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  scene.fog = new THREE.Fog(0x0a0c10, 70, 200);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x2a3020, 0.95));
  const sun = new THREE.DirectionalLight(0xfff3da, 1.6);
  sun.position.set(-18, 34, -10); // rakes across slopes so elevation reads
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  scene.add(sun.target);

  // Right-drag pan + wheel zoom; rotation locked (the board reads at one tilt),
  // left button left alone for unit/move/facing gestures.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableRotate = false;
  controls.screenSpacePanning = false; // pan slides along the ground plane
  controls.zoomToCursor = true;
  controls.enableDamping = true;
  controls.dampingFactor = 0.14;
  controls.mouseButtons = {
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  } as typeof controls.mouseButtons; // LEFT unset → ignored by the controls

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  const frame = (min: THREE.Vector3, max: THREE.Vector3) => {
    const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
    const span = Math.max(max.x - min.x, max.z - min.z, 1);
    // Tilted ~52° from horizontal, pulled back to fit the span.
    const dist = span * 1.05;
    camera.position.set(center.x, center.y + dist * 0.95, center.z + dist * 0.78);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.minDistance = span * 0.18;
    controls.maxDistance = span * 1.9;
    controls.update();
    // Size the shadow frustum to the board.
    sun.position.set(center.x - span * 0.45, span * 0.9, center.z - span * 0.28);
    sun.target.position.copy(center);
    const s = span * 0.7;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = span * 3;
    sun.shadow.camera.updateProjectionMatrix();
  };

  const tick = () => controls.update();
  const render = () => renderer.render(scene, camera);
  const dispose = () => {
    controls.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { renderer, scene, camera, resize, frame, tick, render, dispose };
}
