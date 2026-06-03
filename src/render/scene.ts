import * as THREE from "three";
import { cameraPosition } from "./camera";
import type { ThemeDef } from "../config/runConfig";

// Owns the Three.js renderer, scene, camera and lights. Sky/fog come from the
// run's theme; the level (floor + walls/cover/hazard) is added by the caller.
// The camera is a perspective tilt-follow cam tracking the player on the flat
// arena floor (the `y` arg stays 0 here, but kept for flexibility).

export interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
  followCamera: (x: number, y: number, z: number) => void;
  render: () => void;
  dispose: () => void;
}

export function createView(container: HTMLElement, theme: ThemeDef): View {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.palette.sky);
  scene.fog = new THREE.Fog(theme.palette.fog, 55, 150); // depth cueing

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x202a3a, 0.75));
  const sun = new THREE.DirectionalLight(0xfff2d6, 1.15);
  sun.position.set(24, 40, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const span = 60;
  sun.shadow.camera.left = -span;
  sun.shadow.camera.right = span;
  sun.shadow.camera.top = span;
  sun.shadow.camera.bottom = -span;
  sun.shadow.camera.far = 160;
  scene.add(sun);
  scene.add(sun.target);

  const resize = () => {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  const focus = new THREE.Vector3();
  const followCamera = (x: number, y: number, z: number) => {
    const p = cameraPosition(x, z, y);
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(focus.set(x, y, z));
    sun.target.position.set(x, y, z); // keep the shadow frustum on the player
  };

  const render = () => renderer.render(scene, camera);
  const dispose = () => {
    renderer.dispose();
    renderer.domElement.remove();
  };

  return { renderer, scene, camera, resize, followCamera, render, dispose };
}
