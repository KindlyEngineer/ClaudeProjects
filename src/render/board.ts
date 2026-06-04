import * as THREE from "three";
import type { GameState, UnitInstance } from "../sim/state";
import { hexCorners, hexKey, hexToWorld, neighbor } from "../sim/hex";
import { terrain } from "../data/terrain";
import { unitType } from "../data/units";
import type { UnitClass } from "../data/types";

// Builds the 2.5D board from game state: a continuous heightmap terrain surface
// (per-hex elevation, smoothed at shared corners so seams are seamless), a hex
// grid overlay, the objective zone, and programmer-art unit markers that show
// side, class and facing. Pure read of state → a THREE.Group.

const ELEV = 1.35; // world height per elevation unit
const LIFT = 0.03; // grid/zone offset above the surface to avoid z-fighting
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

export function buildBoard(state: GameState): Board {
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
      positions.push(c.x, cy, c.z, ax, cornerHeight(ax, az), az, bx, cornerHeight(bx, bz), bz);
      for (let v = 0; v < 3; v++) colors.push(col.r, col.g, col.b);
      grow(ax, cornerHeight(ax, az), az);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const surface = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0,
      flatShading: true,
      side: THREE.DoubleSide, // fan winding yields downward normals; light both faces
    }),
  );
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
    group.add(buildUnitMarker(u, size, (cell?.elevation ?? 0) * ELEV));
  }

  min.y = 0;
  max.y = Math.max(max.y, 3);
  return { group, min, max };
}

function buildUnitMarker(u: UnitInstance, size: number, lift: number): THREE.Group {
  const g = new THREE.Group();
  const t = unitType(u.typeId);
  const style = CLASS_STYLE[t.cls];
  const c = hexToWorld(u.hex, size);

  const color = SIDE_COLOR[u.side];
  const body = new THREE.Mesh(
    style.geo(),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: new THREE.Color(color).multiplyScalar(0.15) }),
  );
  body.position.set(0, 0.45, 0);
  g.add(body);

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

  g.add(makeLabel(style.abbr, color));

  // Lift the whole marker to its hex's surface height (reads as grounded) and
  // scale up so units stay legible on the larger board.
  g.scale.setScalar(1.8);
  g.position.set(c.x, lift, c.z);
  return g;
}

function makeLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(8,10,14,0.85)";
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 38px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  sprite.position.set(0, 1.3, 0);
  sprite.scale.set(0.8, 0.8, 0.8);
  return sprite;
}
