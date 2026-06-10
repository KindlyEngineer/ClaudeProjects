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

/** The six facing choices at a move destination: an arrow on each hex face the
 *  unit could finish fronting, with the currently aimed face (`active`) drawn
 *  brighter and larger so the drag-to-face gesture reads at a glance. Each arrow
 *  carries `userData.facing` (a raycast can still resolve a direct click to it). */
export function buildFacingPicker(state: GameState, hex: Hex, active: Direction): THREE.Group {
  const group = new THREE.Group();
  const size = state.map.hexSize;
  const c = hexToWorld(hex, size);
  const y = hexSurfaceY(state, hex) + 0.5;
  const up = new THREE.Vector3(0, 1, 0);
  for (let d = 0; d < 6; d++) {
    const nb = hexToWorld(neighbor(hex, d as Direction), size);
    const dir = new THREE.Vector3(nb.x - c.x, 0, nb.z - c.z).normalize();
    const isActive = d === active;
    const arrow = new THREE.Mesh(
      new THREE.ConeGeometry(size * (isActive ? 0.22 : 0.15), size * (isActive ? 0.62 : 0.42), 12),
      new THREE.MeshBasicMaterial({ color: isActive ? 0xf0bc5c : 0x8a6a2f, transparent: true, opacity: isActive ? 1 : 0.55, depthTest: false }),
    );
    arrow.quaternion.setFromUnitVectors(up, dir); // lay the cone pointing outward
    arrow.position.set(c.x + dir.x * size * (isActive ? 0.78 : 0.7), y, c.z + dir.z * size * (isActive ? 0.78 : 0.7));
    arrow.renderOrder = 10; // draw over the board so it always reads/clicks
    arrow.userData.facing = d;
    group.add(arrow);
  }
  return group;
}

/** Small billboarded text labels over hexes — the hit-chance preview ("62%")
 *  above each targetable enemy. */
export function buildHexLabels(state: GameState, items: ReadonlyArray<{ hex: Hex; text: string }>): THREE.Group {
  const group = new THREE.Group();
  const size = state.map.hexSize;
  for (const item of items) {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 48;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(10,11,13,0.92)";
    ctx.fillRect(2, 2, 92, 44);
    ctx.strokeStyle = "#c4554a";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#d8a03c";
    ctx.font = "bold 26px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.text, 48, 26);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    const c = hexToWorld(item.hex, size);
    sprite.position.set(c.x, hexSurfaceY(state, item.hex) + 3.6, c.z);
    sprite.scale.set(2.0, 1.0, 1);
    sprite.renderOrder = 11;
    group.add(sprite);
  }
  return group;
}
