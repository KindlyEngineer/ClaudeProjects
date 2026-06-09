import * as THREE from "three";
import type { EffectId } from "../data/effects";
import type { Side, UnitClass } from "../data/types";
import { unitType } from "../data/units";
import { hexToWorld, neighbor, type Direction, type Hex } from "../sim/hex";

// Procedural unit models (brief amendment 2026-06-09: fidelity in scope,
// internal/code-built preferred). Each class gets a small multi-part rig built
// from primitives — legs/torso/gun for mechs, hull/turret/barrel for tanks —
// oriented FORWARD = +X so a facing rotation aims the whole model. Builders
// return named part refs (turret, barrel, muzzle) so the stage can animate
// recoil and aim. Everything casts shadows; materials are fresh per instance
// (markers are dimmed/ghosted by traversing their own materials).

export interface ModelParts {
  turret?: THREE.Object3D; // rotates toward the target when firing
  barrel?: THREE.Object3D; // recoils
  muzzle?: THREE.Object3D; // world anchor for flash + tracer origin
}

export interface UnitModel {
  group: THREE.Group;
  parts: ModelParts;
}

const DARK = 0x23262c; // tracks, wheels, under-hulls
const GUNMETAL = 0x3a3f48;
const SIDE_COLOR: Record<string, number> = { blue: 0x4a90ff, red: 0xff5a4a };

function mat(color: number, emissiveScale = 0.12): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.18,
    emissive: new THREE.Color(color).multiplyScalar(emissiveScale),
  });
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

function cyl(rTop: number, rBot: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 12), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/** A horizontal gun barrel along +X whose tip carries the muzzle anchor. */
function gunBarrel(r: number, len: number, m: THREE.Material, x: number, y: number, z: number, pitch = 0): { barrel: THREE.Group; muzzle: THREE.Object3D } {
  const barrel = new THREE.Group();
  const tube = cyl(r, r * 1.15, len, m);
  tube.rotation.z = -Math.PI / 2; // lay the cylinder along +X
  tube.position.x = len / 2;
  barrel.add(tube);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(len, 0, 0);
  barrel.add(muzzle);
  barrel.position.set(x, y, z);
  barrel.rotation.z = pitch; // artillery elevates
  return { barrel, muzzle };
}

function wheels(m: THREE.Material, xs: number[], y: number, z: number, r: number, w: number): THREE.Group {
  const g = new THREE.Group();
  for (const x of xs) {
    for (const s of [-1, 1]) {
      const wheel = cyl(r, r, w, m, x, y, s * z);
      wheel.rotation.x = Math.PI / 2;
      g.add(wheel);
    }
  }
  return g;
}

/** A little soldier figure (body + head), kneeling variant slightly lower. */
function trooper(m: THREE.Material, head: THREE.Material, x: number, z: number, kneel = false): THREE.Group {
  const g = new THREE.Group();
  const h = kneel ? 0.1 : 0.14;
  g.add(cyl(0.035, 0.045, h, m, 0, h / 2, 0));
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), head);
  skull.position.set(0, h + 0.035, 0);
  skull.castShadow = true;
  g.add(skull);
  g.position.set(x, 0, z);
  return g;
}

// ── Class builders (forward = +X) ─────────────────────────────────────────────

function mechModel(color: number, light: boolean): UnitModel {
  const g = new THREE.Group();
  const body = mat(color);
  const dark = mat(DARK, 0.04);
  const gun = mat(GUNMETAL, 0.05);
  const s = light ? 0.82 : 1; // the scout is slighter

  // Legs + hip
  for (const side of [-1, 1]) {
    g.add(box(0.14 * s, 0.16, 0.16 * s, dark, -0.02, 0.08, side * 0.12 * s)); // foot/shin
    g.add(box(0.12 * s, 0.22, 0.13 * s, body, 0, 0.26, side * 0.12 * s)); // thigh
  }
  g.add(box(0.3 * s, 0.1, 0.26 * s, dark, 0, 0.4, 0)); // hip plate

  // Torso + cockpit visor
  g.add(box(0.34 * s, 0.26, 0.3 * s, body, 0.01, 0.58, 0));
  const visor = box(0.05, 0.07, 0.16 * s, new THREE.MeshStandardMaterial({ color: 0x9fe0ff, emissive: 0x3fb0ff, emissiveIntensity: 0.7, roughness: 0.3 }), 0.18 * s, 0.62, 0);
  g.add(visor);
  g.add(box(0.16 * s, 0.07, 0.2 * s, dark, -0.06, 0.75, 0)); // dorsal housing
  const antenna = cyl(0.008, 0.008, 0.22, gun, -0.12 * s, 0.88, 0.08 * s);
  g.add(antenna);

  // Right-shoulder cannon (the signature silhouette), left fist counterweight.
  g.add(box(0.12 * s, 0.12, 0.1, body, 0, 0.66, 0.21 * s)); // shoulder
  const { barrel, muzzle } = gunBarrel(light ? 0.032 : 0.042, light ? 0.34 : 0.44, gun, 0.04, 0.66, 0.21 * s);
  g.add(barrel);
  g.add(box(0.1 * s, 0.16, 0.09, dark, 0.04, 0.6, -0.22 * s)); // left arm

  return { group: g, parts: { barrel, muzzle } };
}

function armorModel(color: number): UnitModel {
  const g = new THREE.Group();
  const body = mat(color);
  const dark = mat(DARK, 0.04);
  const gun = mat(GUNMETAL, 0.05);
  for (const side of [-1, 1]) g.add(box(0.6, 0.13, 0.13, dark, 0, 0.08, side * 0.19)); // tracks
  g.add(box(0.54, 0.13, 0.32, body, 0, 0.19, 0)); // hull
  g.add(box(0.2, 0.05, 0.3, body, -0.18, 0.27, 0)); // engine deck
  const turret = new THREE.Group();
  turret.add(box(0.26, 0.11, 0.22, body, 0, 0, 0));
  turret.add(box(0.08, 0.05, 0.1, dark, -0.1, 0.07, 0.04)); // cupola
  const { barrel, muzzle } = gunBarrel(0.034, 0.46, gun, 0.1, 0.01, 0);
  turret.add(barrel);
  turret.position.set(0.04, 0.31, 0);
  g.add(turret);
  return { group: g, parts: { turret, barrel, muzzle } };
}

function reconModel(color: number): UnitModel {
  const g = new THREE.Group();
  const body = mat(color);
  const dark = mat(DARK, 0.04);
  g.add(wheels(dark, [-0.16, 0.16], 0.07, 0.15, 0.07, 0.05));
  g.add(box(0.42, 0.1, 0.24, body, 0, 0.16, 0)); // low hull
  g.add(box(0.16, 0.09, 0.2, body, -0.06, 0.26, 0)); // cab
  const mast = cyl(0.008, 0.008, 0.3, mat(GUNMETAL, 0.05), -0.14, 0.42, 0); // sensor mast
  g.add(mast);
  const dish = box(0.04, 0.05, 0.08, mat(0xd8e4ff, 0.3), -0.14, 0.56, 0);
  g.add(dish);
  const { barrel, muzzle } = gunBarrel(0.02, 0.2, mat(GUNMETAL, 0.05), 0.14, 0.3, 0.0);
  g.add(barrel);
  return { group: g, parts: { barrel, muzzle } };
}

function artilleryModel(color: number): UnitModel {
  const g = new THREE.Group();
  const body = mat(color);
  const dark = mat(DARK, 0.04);
  for (const side of [-1, 1]) g.add(box(0.5, 0.12, 0.12, dark, 0, 0.07, side * 0.17)); // tracks
  g.add(box(0.46, 0.12, 0.3, body, 0, 0.17, 0)); // chassis
  g.add(box(0.22, 0.14, 0.24, body, -0.1, 0.3, 0)); // casemate
  const { barrel, muzzle } = gunBarrel(0.05, 0.6, mat(GUNMETAL, 0.05), 0.0, 0.33, 0, 0.6); // elevated tube
  g.add(barrel);
  g.add(box(0.06, 0.18, 0.04, dark, -0.26, 0.18, 0)); // recoil spade
  return { group: g, parts: { barrel, muzzle } };
}

function infantryModel(color: number, engineer: boolean): UnitModel {
  const g = new THREE.Group();
  const body = mat(color, 0.08);
  const head = mat(DARK, 0.04);
  g.add(trooper(body, head, 0.08, 0.02));
  g.add(trooper(body, head, -0.06, 0.12, true));
  g.add(trooper(body, head, -0.04, -0.12));
  if (engineer) {
    g.add(trooper(body, head, 0.1, -0.14, true));
    g.add(box(0.14, 0.1, 0.1, mat(0xc9a227, 0.15), -0.14, 0.05, 0.0)); // demo crate
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0.14, 0.12, 0);
  g.add(muzzle);
  return { group: g, parts: { muzzle } };
}

function supplyModel(color: number): UnitModel {
  const g = new THREE.Group();
  const body = mat(color);
  const dark = mat(DARK, 0.04);
  g.add(wheels(dark, [-0.18, 0.02, 0.2], 0.07, 0.16, 0.07, 0.05));
  g.add(box(0.16, 0.17, 0.26, body, 0.21, 0.23, 0)); // cab
  g.add(box(0.05, 0.06, 0.2, mat(0xbcd8ff, 0.35), 0.29, 0.27, 0)); // windshield
  g.add(box(0.38, 0.16, 0.28, mat(0x6a705f, 0.06), -0.08, 0.24, 0)); // canvas bed
  return { group: g, parts: {} };
}

/** Build the display model for a unit type. Forward = +X. */
export function buildUnitModel(typeId: string, side: Side): UnitModel {
  const t = unitType(typeId);
  const color = SIDE_COLOR[side];
  switch (t.cls) {
    case "mech":
      return mechModel(color, t.light);
    case "armor":
      return armorModel(color);
    case "recon":
      return reconModel(color);
    case "artillery":
      return artilleryModel(color);
    case "infantry":
      return infantryModel(color, false);
    case "engineer":
      return infantryModel(color, true);
    case "supply":
      return supplyModel(color);
  }
}

/** Battlefield-effect marker: a smoke cloud (translucent puffs) or a
 *  fortification (an arc of sandbag blocks). Built per hex; no shadows for
 *  smoke so the cloud reads soft. */
export function buildEffectMarker(kind: EffectId, seed: number): THREE.Group {
  const g = new THREE.Group();
  if (kind === "smoke") {
    const m = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.34, roughness: 1, depthWrite: false });
    const puffs = [
      [0, 0.5, 0, 0.46],
      [0.32, 0.34, 0.18, 0.3],
      [-0.3, 0.4, -0.12, 0.34],
      [0.05, 0.74, -0.2, 0.28],
      [-0.12, 0.3, 0.3, 0.26],
    ];
    for (const [x, y, z, r] of puffs) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m);
      p.position.set(x + (seed % 3) * 0.04, y, z - (seed % 2) * 0.05);
      g.add(p);
    }
  } else {
    const bag = new THREE.MeshStandardMaterial({ color: 0x6e5d41, roughness: 0.95, metalness: 0 });
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI / 4.4) * (i - 2) + (seed % 5) * 0.25; // an arc, varied by seed
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.13), bag);
      b.position.set(Math.cos(a) * 0.52, 0.06, Math.sin(a) * 0.52);
      b.rotation.y = -a;
      b.castShadow = true;
      g.add(b);
      if (i % 2 === 0) {
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.12), bag);
        top.position.set(Math.cos(a) * 0.52, 0.16, Math.sin(a) * 0.52);
        top.rotation.y = -a + 0.15;
        top.castShadow = true;
        g.add(top);
      }
    }
  }
  return g;
}

/** A burnt-out wreck where a unit died: scorch ring + collapsed dark hull. */
export function buildWreck(cls: UnitClass, seed: number): THREE.Group {
  const g = new THREE.Group();
  const char = new THREE.MeshStandardMaterial({ color: 0x191b1e, roughness: 0.95, metalness: 0.05 });
  const scorch = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 18),
    new THREE.MeshBasicMaterial({ color: 0x0c0d0f, transparent: true, opacity: 0.75, depthWrite: false }),
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.02;
  g.add(scorch);
  const bulk = cls === "infantry" || cls === "engineer" ? box(0.2, 0.05, 0.2, char) : box(0.45, 0.12, 0.3, char);
  bulk.position.y = 0.07;
  bulk.rotation.set(0.06 + (seed % 3) * 0.05, (seed % 6) * 1.05, 0.1);
  g.add(bulk);
  if (cls !== "infantry" && cls !== "engineer") {
    const plate = box(0.2, 0.03, 0.16, char, -0.1, 0.16, 0.08);
    plate.rotation.set(0.5, 0.3, 0.2);
    g.add(plate);
  }
  return g;
}

// ── Marker assembly (model + facing chevron + badge + banner + ring) ──────────

export interface MarkerData {
  id: number;
  typeId: string;
  side: Side;
  hex: Hex;
  facing: Direction;
  structure: number;
  crits: string[];
  inSupply: boolean;
}

export interface MarkerOpts {
  size: number; // hex circumradius
  lift: number; // surface height at the hex
  intent?: string;
  dim?: boolean;
  ghost?: boolean;
  selected?: boolean;
}

const ABBR: Record<UnitClass, string> = {
  mech: "M",
  armor: "A",
  recon: "R",
  artillery: "G",
  infantry: "I",
  engineer: "E",
  supply: "S",
};

/** Yaw that points the model's +X forward axis at the faced neighbour. */
export function facingAngle(hex: Hex, facing: Direction, size: number): number {
  const here = hexToWorld(hex, size);
  const ahead = hexToWorld(neighbor(hex, facing), size);
  return Math.atan2(-(ahead.z - here.z), ahead.x - here.x);
}

export interface Marker {
  group: THREE.Group;
  model: UnitModel;
}

export function buildUnitMarker(u: MarkerData, opts: MarkerOpts): Marker {
  const g = new THREE.Group();
  g.userData.unitId = u.id;
  const t = unitType(u.typeId);
  const color = SIDE_COLOR[u.side];
  const c = hexToWorld(u.hex, opts.size);

  const model = buildUnitModel(u.typeId, u.side);
  model.group.rotation.y = facingAngle(u.hex, u.facing, opts.size);
  model.group.userData.unitId = u.id;
  g.add(model.group);

  // Ground chevron — the facing read for the armour-arc rules.
  const chev = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.22, 3),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: opts.ghost ? 0.25 : 0.8, depthWrite: false }),
  );
  const here = hexToWorld(u.hex, opts.size);
  const ahead = hexToWorld(neighbor(u.hex, u.facing), opts.size);
  const dir = new THREE.Vector3(ahead.x - here.x, 0, ahead.z - here.z).normalize();
  chev.position.set(dir.x * 0.46, 0.04, dir.z * 0.46);
  chev.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.add(chev);

  if (opts.selected) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(opts.size * 0.62, opts.size * 0.82, 24),
      new THREE.MeshBasicMaterial({ color: 0xffe66a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.06, 0);
    g.add(ring);
  }

  g.add(makeBadge(u, ABBR[t.cls], color, opts.ghost ?? false));
  if (opts.intent) g.add(makeIntentBanner(opts.intent, color, u.id % 2)); // stagger adjacent banners

  // Faded presentation: ghosts are memories, dim units are spent/non-orderable.
  const faded = opts.dim || opts.ghost;
  if (faded) {
    const opacity = opts.ghost ? 0.3 : 0.45;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        m.transparent = true;
        m.opacity = Math.min(m.opacity, opacity);
      }
    });
  }

  g.scale.setScalar(1.8); // legibility at the board camera distance
  g.position.set(c.x, opts.lift, c.z);
  return { group: g, model };
}

// A wide billboarded banner above a mech showing its commander's current intent.
function makeIntentBanner(text: string, color: number, stagger: number): THREE.Sprite {
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
  sprite.position.set(0, 2.5 + stagger * 0.9, 0);
  sprite.scale.set(2.6 * (W / H), 2.6, 1);
  return sprite;
}

// A billboarded badge: side-coloured ring, a health arc (green→red by remaining
// structure), the class letter, and small status pips (orange = shaken crew,
// red = cut off from supply). Ghosts get a grey ring and no supply pip: the
// data is last-known, not live.
function makeBadge(u: MarkerData, abbr: string, color: number, ghost: boolean): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

  ctx.fillStyle = "rgba(8,10,14,0.88)";
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ghost ? "#8a8f9a" : hex(color); // grey ring = remembered, not live
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

  if (!u.inSupply && !ghost) {
    ctx.fillStyle = "#ff4a4a"; // cut off from supply
    ctx.beginPath();
    ctx.arc(50, 16, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
  sprite.position.set(0, 1.45, 0);
  sprite.scale.set(0.8, 0.8, 0.8);
  return sprite;
}
