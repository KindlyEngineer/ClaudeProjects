import * as THREE from "three";
import { hexCorners, hexToWorld, type Hex } from "../sim/hex";
import { hexSurfaceY } from "./board";
import type { GameState } from "../sim/state";

// Interaction overlays: translucent filled hexes the interactive UI lays over the
// board to show a selected unit's reachable range and its valid targets. Pure
// read of state → a THREE.Group (render never mutates the sim). Colours are the
// caller's call (move = blue, attack = red, resupply = green).

const LIFT = 0.05; // sit just above the surface to avoid z-fighting with terrain
const INSET = 0.82; // shrink toward the centre so the hex grid still reads through

/** A group of flat, translucent hex tiles over the given hexes. */
export function buildHexOverlay(state: GameState, hexes: readonly Hex[], color: number, opacity = 0.32): THREE.Group {
  const group = new THREE.Group();
  if (hexes.length === 0) return group;
  const size = state.map.hexSize;
  const corners = hexCorners(size);
  const positions: number[] = [];
  for (const h of hexes) {
    const c = hexToWorld(h, size);
    const y = hexSurfaceY(state, h) + LIFT;
    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      // centre → corner a → corner b, inset toward the centre.
      positions.push(c.x, y, c.z);
      positions.push(c.x + a.x * INSET, y, c.z + a.z * INSET);
      positions.push(c.x + b.x * INSET, y, c.z + b.z * INSET);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  );
  group.add(mesh);
  return group;
}
