import * as THREE from "three";
import type { GameState } from "../sim/state";
import { hexCorners, hexKey, hexToWorld, type Hex } from "../sim/hex";
import { terrain } from "../data/terrain";
import { unitType } from "../data/units";
import type { Side } from "../data/types";
import { isScouted } from "../sim/vision";
import { buildEffectMarker, buildUnitMarker, type MarkerData } from "./models";

// Builds the 2.5D board from game state: a continuous heightmap terrain surface
// (per-hex elevation, smoothed at shared corners so seams are seamless), a hex
// grid overlay, the objective zone, and the procedural unit models
// (render/models.ts). Pure read of state → THREE groups. buildTerrain is shared
// with the animated interactive stage; buildBoard adds static markers on top
// (the headless/verification path).

export const ELEV = 1.2; // world height per elevation unit
const LIFT = 0.03; // grid/zone offset above the surface to avoid z-fighting

/** Surface height (world Y) at a hex centre — where unit markers and overlays
 *  sit. Mirrors marker placement so selection/range overlays land on the ground. */
export function hexSurfaceY(state: GameState, h: Hex): number {
  return (state.cells.get(hexKey(h))?.elevation ?? 0) * ELEV;
}

/** Optional decoration: which unit ids to dim (spent / not the player's to
 *  order) and which one is selected (gets a highlight ring).
 *  `viewSide` renders the board AS THAT SIDE SEES IT (fog of war): enemies only
 *  where its belief puts them — in-sight units live, remembered ones as faded
 *  "ghosts" at their last-known hex, unscouted ones not at all. Omit it (the
 *  headless/verification modes) to render ground truth. */
export interface BoardOpts {
  dim?: Set<number>;
  selectedId?: number | null;
  viewSide?: Side;
}

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

/** The static ground: heightmap surface + hex grid + objective ring + bounds.
 *  Built once per match (shared by the static board and the animated stage). */
export function buildTerrain(state: GameState): Board {
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
  surface.receiveShadow = true;
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

  min.y = 0;
  max.y = Math.max(max.y, 3);
  return { group, min, max };
}

/** What `viewSide` (or ground truth, if omitted) should draw for each unit. */
export function markerDataFor(state: GameState, u: GameState["units"][number], viewSide?: Side): { data: MarkerData; ghost: boolean } | null {
  if (u.structure <= 0) return null;
  if (viewSide && u.side !== viewSide) {
    const s = state.belief[viewSide].get(u.id);
    if (!s) return null; // never scouted — does not exist to this side
    if (!s.visibleNow) {
      return {
        ghost: true,
        data: { id: s.id, typeId: s.typeId, side: s.side, hex: s.hex, facing: s.facing, structure: s.structure, crits: s.crits, inSupply: true },
      };
    }
  }
  return { ghost: false, data: u };
}

/** Battlefield effects a side should see: smoke reads from anywhere (it's a
 *  towering cloud); fortifications only where the side has eyes. No viewSide →
 *  ground truth (the verification path). */
export function buildEffectsGroup(state: GameState, viewSide?: Side): THREE.Group {
  const g = new THREE.Group();
  const size = state.map.hexSize;
  let i = 0;
  for (const e of state.effects) {
    i++;
    if (e.kind !== "smoke" && viewSide && !isScouted(state, viewSide, e.hex)) continue;
    const marker = buildEffectMarker(e.kind, i);
    const c = hexToWorld(e.hex, size);
    marker.scale.setScalar(1.6);
    marker.position.set(c.x, hexSurfaceY(state, e.hex), c.z);
    g.add(marker);
  }
  return g;
}

/** Static board: terrain + effects + a marker per (visible) unit. The headless
 *  and verification path; the interactive game uses the animated stage instead. */
export function buildBoard(state: GameState, opts: BoardOpts = {}): Board {
  const board = buildTerrain(state);
  board.group.add(buildEffectsGroup(state, opts.viewSide));
  const size = state.map.hexSize;
  for (const u of state.units) {
    const m = markerDataFor(state, u, opts.viewSide);
    if (!m) continue;
    // Enemy commander intents stay hidden in a fogged view — legibility is for
    // YOUR commander; the enemy's mind is not on display.
    const showIntent =
      !m.ghost && unitType(u.typeId).cls === "mech" && (!opts.viewSide || u.side === opts.viewSide);
    const marker = buildUnitMarker(m.data, {
      size,
      lift: hexSurfaceY(state, m.data.hex),
      intent: showIntent ? state.intents[u.id] : undefined,
      dim: opts.dim?.has(u.id) ?? false,
      ghost: m.ghost,
      selected: opts.selectedId === m.data.id,
    });
    board.group.add(marker.group);
  }
  return board;
}
