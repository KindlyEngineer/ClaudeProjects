import * as THREE from "three";
import { hexCorners, hexToWorld, neighbor, type Direction, type Hex } from "../sim/hex";
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

/** The six facing choices at a move destination: an arrow on each hex face that
 *  the unit could finish fronting. Each arrow mesh carries `userData.facing` so a
 *  raycast resolves the click to a Direction; the natural travel direction is
 *  brighter as the suggested default. The player must pick one to commit a move. */
export function buildFacingPicker(state: GameState, hex: Hex, natural: Direction): THREE.Group {
  const group = new THREE.Group();
  const size = state.map.hexSize;
  const c = hexToWorld(hex, size);
  const y = hexSurfaceY(state, hex) + 0.5;
  const up = new THREE.Vector3(0, 1, 0);
  for (let d = 0; d < 6; d++) {
    const nb = hexToWorld(neighbor(hex, d as Direction), size);
    const dir = new THREE.Vector3(nb.x - c.x, 0, nb.z - c.z).normalize();
    const isNatural = d === natural;
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(size * 0.17, size * 0.5, 12),
      new THREE.MeshBasicMaterial({ color: isNatural ? 0xfff2a8 : 0xffd24a, transparent: true, opacity: isNatural ? 1 : 0.8, depthTest: false }),
    );
    arrow.quaternion.setFromUnitVectors(up, dir); // lay the cone pointing outward
    arrow.position.set(c.x + dir.x * size * 0.7, y, c.z + dir.z * size * 0.7);
    arrow.renderOrder = 10; // draw over the board so it always reads/clicks
    arrow.userData.facing = d;
    group.add(arrow);
  }
  return group;
}
