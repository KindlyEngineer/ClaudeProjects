import * as THREE from "three";

// Owns the renderer, scene, camera and lights. The camera is a fixed tilted
// view (the tactics "board" angle) framed to fit the whole map. Render only
// reads sim state; this module knows nothing about game rules.

export interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
  /** Point the tilted camera so the given world-space box fills the frame. */
  frame: (min: THREE.Vector3, max: THREE.Vector3) => void;
  render: () => void;
  dispose: () => void;
}

export function createView(container: HTMLElement): View {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0c10);
  scene.fog = new THREE.Fog(0x0a0c10, 70, 180);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0xbcd0ff, 0x2a3020, 1.05));
  const sun = new THREE.DirectionalLight(0xfff3da, 1.5);
  sun.position.set(-18, 34, -10); // rakes across slopes so elevation reads
  scene.add(sun);

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
  };

  const render = () => renderer.render(scene, camera);
  const dispose = () => {
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { renderer, scene, camera, resize, frame, render, dispose };
}
