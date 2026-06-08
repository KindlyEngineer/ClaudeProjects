import * as THREE from "three";
import type { GameState, UnitInstance } from "../sim/state";
import { hexCorners, hexKey, hexToWorld, neighbor, type Hex } from "../sim/hex";
import { terrain } from "../data/terrain";
import { unitType } from "../data/units";
import type { UnitClass } from "../data/types";

// Builds the 2.5D board from game state: a continuous heightmap terrain surface
// (per-hex elevation, smoothed at shared corners so seams are seamless), a hex
// grid overlay, the objective zone, and programmer-art unit markers that show
// side, class and facing. Pure read of state → a THREE.Group.

export const ELEV = 1.2; // world height per elevation unit
const LIFT = 0.03; // grid/zone offset above the surface to avoid z-fighting

/** Surface height (world Y) at a hex centre — where unit markers and overlays
 *  sit. Mirrors marker placement so selection/range overlays land on the ground. */
export function hexSurfaceY(state: GameState, h: Hex): number {
  return (state.cells.get(hexKey(h))?.elevation ?? 0) * ELEV;
}

/** Optional interactive decoration: which unit ids to dim (spent / not the
 *  player's to order) and which one is selected (gets a highlight ring). */
export interface BoardOpts {
  dim?: Set<number>;
  selectedId?: number | null;
}
const SIDE_COLOR: Record<string, number> = { blue: 0x4a90ff, red: 0xff5a4a };

interface ClassStyle {
  abbr: string;
  geo: () => THREE.BufferGeometry;
}
const CLASS_STYLE: Record<UnitClass, ClassStyle> = {
  mech: { abbr: "M", geo: () => new THREE.OctahedronGeometry(0.42) },
  armor: { abbr: "A", geo: () => new THREE.BoxGeometry(0.6, 0.34, 0.46) },
  recon: { abbr: "R", geo: () => new THREE.ConeGeometry(0.3, 0.6, 6) },
  artillery: { abbr: "G", geo: () => new THREE.CylinderGeometry(0.26, 0.32, 0.5, 8) },
  infantry: { abbr: "I", geo: () => new THREE.SphereGeometry(0.3, 10, 8) },
  engineer: { abbr: "E", geo: () => new THREE.TetrahedronGeometry(0.42) },
  supply: { abbr: "S", geo: () => new THREE.BoxGeometry(0.5, 0.5, 0.5) },
};

export interface Board {
  group: THREE.Group;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/** Per-vertex normals averaged over vertices sharing an XZ position (the surface
 *  is a heightfield), forced upward so the lit face is always the top. This
 *  smooths the seams between hexes into a continuous rolling surface. */
function smoothNormals(positions: number[]): number[] {
  const acc = new Map<string, [number, number, number]>();
  const key = (x: number, z: number) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  for (let t = 0; t < positions.length; t += 9) {
    const ax = positions[t], ay = positions[t + 1], az = positions[t + 2];
    const bx = positions[t + 3], by = positions[t + 4], bz = positions[t + 5];
    const cx = positions[t + 6], cy = positions[t + 7], cz = positions[t + 8];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } // upward
    for (const off of [0, 3, 6]) {
      const k = key(positions[t + off], positions[t + off + 2]);
      const e = acc.get(k) ?? [0, 0, 0];
      e[0] += nx; e[1] += ny; e[2] += nz;
      acc.set(k, e);
    }
  }
  const out = new Array<number>(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const e = acc.get(key(positions[i], positions[i + 2]))!;
    const len = Math.hypot(e[0], e[1], e[2]) || 1;
    out[i] = e[0] / len;
    out[i + 1] = e[1] / len;
    out[i + 2] = e[2] / len;
  }
  return out;
}

export function buildBoard(state: GameState, opts: BoardOpts = {}): Board {
  const group = new THREE.Group();
  const size = state.map.hexSize;
  const corners = hexCorners(size);

  // ── Shared-corner heights → a continuous (seamless) surface. ──
  const cornerSum = new Map<string, { sum: number; n: number }>();
  const cornerKey = (x: number, z: number) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  for (const cell of state.map.cells) {
    const c = hexToWorld(cell.hex, size);
    for (const off of corners) {
      const k = cornerKey(c.x + off.x, c.z + off.z);
      const e = cornerSum.get(k) ?? { sum: 0, n: 0 };
      e.sum += cell.elevation;
      e.n += 1;
      cornerSum.set(k, e);
    }
  }
  const cornerHeight = (x: number, z: number) => {
    const e = cornerSum.get(cornerKey(x, z));
    return (e ? e.sum / e.n : 0) * ELEV;
  };

  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const grow = (x: number, y: number, z: number) => {
    min.min(new THREE.Vector3(x, y, z));
    max.max(new THREE.Vector3(x, y, z));
  };

  // ── Terrain surface (vertex-coloured per hex, smooth heights). ──
  const positions: number[] = [];
  const colors: number[] = [];
  const col = new THREE.Color();
  for (const cell of state.map.cells) {
    const c = hexToWorld(cell.hex, size);
    const cy = cell.elevation * ELEV;
    col.set(terrain(cell.terrain).color);
    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      const ax = c.x + a.x;
      const az = c.z + a.z;
      const bx = c.x + b.x;
      const bz = c.z + b.z;
      // Wind center→b→a so the top face is front-facing (upward normal) to the
      // overhead camera — keeps the lit side up without relying on DoubleSide flips.
      positions.push(c.x, cy, c.z, bx, cornerHeight(bx, bz), bz, ax, cornerHeight(ax, az), az);
      for (let v = 0; v < 3; v++) colors.push(col.r, col.g, col.b);
      grow(ax, cornerHeight(ax, az), az);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  // Smooth normals shared across coincident corners → a continuous heightmap
  // surface (rounded relief) rather than faceted per-hex flat shading.
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(smoothNormals(positions), 3));
  const surface = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
    }),
  );
  surface.name = "terrain"; // the interactive UI raycasts this to map a click → hex
  group.add(surface);

  // ── Hex grid overlay. ──
  const gridPts: number[] = [];
  for (const cell of state.map.cells) {
    const c = hexToWorld(cell.hex, size);
    for (let i = 0; i < 6; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      const ax = c.x + a.x;
      const az = c.z + a.z;
      const bx = c.x + b.x;
      const bz = c.z + b.z;
      gridPts.push(ax, cornerHeight(ax, az) + LIFT, az, bx, cornerHeight(bx, bz) + LIFT, bz);
    }
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  group.add(new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: 0x101216, transparent: true, opacity: 0.5 })));

  // ── Objective zone ring. ──
  const zoneSet = new Set(state.objective.zone.map(hexKey));
  for (const cell of state.map.cells) {
    if (!zoneSet.has(hexKey(cell.hex))) continue;
    const c = hexToWorld(cell.hex, size);
    const loop: number[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = corners[i % 6];
      loop.push((c.x + a.x) * 0.86 + c.x * 0.14, cornerHeight(c.x + a.x, c.z + a.z) + LIFT * 2, (c.z + a.z) * 0.86 + c.z * 0.14);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(loop, 3));
    group.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffd24a })));
  }

  // ── Unit markers. ──
  for (const u of state.units) {
    if (u.structure <= 0) continue;
    const cell = state.cells.get(hexKey(u.hex));
    const intent = unitType(u.typeId).cls === "mech" ? state.intents[u.id] : undefined;
    const dim = opts.dim?.has(u.id) ?? false;
    group.add(buildUnitMarker(u, size, (cell?.elevation ?? 0) * ELEV, intent, dim, opts.selectedId === u.id));
  }

  min.y = 0;
  max.y = Math.max(max.y, 3);
  return { group, min, max };
}

function buildUnitMarker(u: UnitInstance, size: number, lift: number, intent: string | undefined, dim: boolean, selected: boolean): THREE.Group {
  const g = new THREE.Group();
  g.userData.unitId = u.id; // raycast target → which unit was clicked
  const t = unitType(u.typeId);
  const style = CLASS_STYLE[t.cls];
  const c = hexToWorld(u.hex, size);

  const color = SIDE_COLOR[u.side];
  const body = new THREE.Mesh(
    style.geo(),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      emissive: new THREE.Color(color).multiplyScalar(selected ? 0.5 : 0.15),
      transparent: dim,
      opacity: dim ? 0.4 : 1, // spent / non-orderable units read as greyed
    }),
  );
  body.position.set(0, 0.45, 0);
  body.userData.unitId = u.id;
  g.add(body);

  if (selected) {
    // A bright ring under the selected unit so the pick reads at a glance.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.62, size * 0.82, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe66a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.06, 0);
    g.add(ring);
  }

  // Facing prong — points toward the faced neighbour.
  const here = hexToWorld(u.hex, size);
  const ahead = hexToWorld(neighbor(u.hex, u.facing), size);
  const dir = new THREE.Vector3(ahead.x - here.x, 0, ahead.z - here.z).normalize();
  const prong = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.4, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  prong.position.set(dir.x * 0.5, 0.45, dir.z * 0.5);
  prong.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.add(prong);

  g.add(makeBadge(u, style.abbr, color));
  if (intent) g.add(makeIntentBanner(intent, color)); // legible commander intent

  // Lift the whole marker to its hex's surface height (reads as grounded) and
  // scale up so units stay legible on the larger board.
  g.scale.setScalar(1.8);
  g.position.set(c.x, lift, c.z);
  return g;
}

// A wide billboarded banner above a mech showing its commander's current intent.
function makeIntentBanner(text: string, color: number): THREE.Sprite {
  const W = 512;
  const H = 96;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(8,10,14,0.82)";
  ctx.beginPath();
  ctx.roundRect(4, 4, W - 8, H - 8, 16);
  ctx.fill();
  ctx.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#eaf0ff";
  ctx.font = "30px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2 + 2, W - 28);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.position.set(0, 2.5, 0);
  sprite.scale.set(2.6 * (W / H), 2.6, 1);
  return sprite;
}

// A billboarded badge: side-coloured ring, a health arc (green→red by remaining
// structure), the class letter, and small status pips (orange = shaken crew,
// red = cut off from supply) — so combat and logistics state read at a glance.
function makeBadge(u: UnitInstance, abbr: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

  ctx.fillStyle = "rgba(8,10,14,0.88)";
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hex(color); // side identity
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 32, 29, 0, Math.PI * 2);
  ctx.stroke();

  const frac = Math.max(0, Math.min(1, u.structure / unitType(u.typeId).structure));
  ctx.strokeStyle = frac > 0.6 ? "#5ad06a" : frac > 0.3 ? "#e6c84a" : "#e0563c";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(32, 32, 23, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = u.crits.includes("shaken") ? "#ffb23c" : "#ffffff";
  ctx.font = "bold 30px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(abbr, 32, 33);

  if (!u.inSupply) {
    ctx.fillStyle = "#ff4a4a"; // cut off from supply
    ctx.beginPath();
    ctx.arc(50, 16, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  sprite.position.set(0, 1.3, 0);
  sprite.scale.set(0.85, 0.85, 0.85);
  return sprite;
}
