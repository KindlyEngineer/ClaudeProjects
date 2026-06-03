import * as THREE from "three";
import type { Terrain } from "../sim/terrain";
import type { ThemeDef } from "../config/runConfig";
import { PIT_LEVEL } from "../config/balance";

// Builds the visible terrain: a subdivided plane displaced by the heightmap and
// vertex-colored by elevation (low→high from the theme palette, pits tinted dark
// as danger). This is the render twin of the pure `Terrain` sampler — same
// heightAt(), so what you see is exactly what the sim rules act on.

const DANGER = new THREE.Color(0x140a12); // pit tint

export function buildTerrainMesh(terrain: Terrain, theme: ThemeDef, extent: number): THREE.Mesh {
  const segments = 200;
  const geo = new THREE.PlaneGeometry(extent, extent, segments, segments);
  geo.rotateX(-Math.PI / 2); // lie flat on XZ, +Y up

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const colors = new Float32Array(n * 3);

  // First pass: displace and record the height range for color normalization.
  let minH = Infinity;
  let maxH = -Infinity;
  const heights = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = terrain.heightAt(x, z);
    heights[i] = h;
    pos.setY(i, h);
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }

  const low = new THREE.Color(theme.palette.low);
  const high = new THREE.Color(theme.palette.high);
  const tmp = new THREE.Color();
  const span = Math.max(0.001, maxH - minH);
  for (let i = 0; i < n; i++) {
    const h = heights[i];
    if (h <= PIT_LEVEL) {
      tmp.copy(DANGER);
    } else {
      tmp.copy(low).lerp(high, (h - minH) / span);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
