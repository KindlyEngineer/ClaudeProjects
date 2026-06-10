import * as THREE from "three";
import type { Side, UnitClass } from "../data/types";
import { unitType } from "../data/units";
import type { GameEvent } from "../sim/events";
import { hexCorners, hexKey, hexToWorld, type Hex } from "../sim/hex";
import type { GameState } from "../sim/state";
import { delay, easeOut, tween } from "./anim";
import { buildEffectsGroup, buildTerrain, hexSurfaceY, markerDataFor, type Board, type BoardOpts } from "./board";
import { bannerText, buildUnitMarker, buildWreck, facingAngle, type Marker } from "./models";

// The animated interactive scene. Unlike the static board (rebuilt wholesale for
// headless verification), the stage PERSISTS: terrain is built once, unit
// visuals are reconciled in place, and sim EVENTS play back as presentation —
// tweened movement, turret aim + recoil + tracer + impact flash, floating
// result text, death → persistent wreck. Fog discipline carries through: an
// event animates only to the extent the viewing side can see it (an unseen
// attacker shelling a seen target reads as incoming fire from nowhere).

const MOVE_MS_PER_HEX = 110;
const FACE_MS = 110;

interface Visual {
  marker: Marker;
  sig: string;
}

export class Stage {
  readonly group = new THREE.Group();
  readonly terrain: Board;
  private size: number;
  private visuals = new Map<number, Visual>();
  private wrecks = new Map<number, THREE.Group>();
  private wreckLayer = new THREE.Group();
  private fx = new THREE.Group(); // transient effects (tracers, flashes, text)
  private effectsLayer = new THREE.Group(); // standing battlefield effects
  private effectsSig = "";
  private hoverRing: THREE.LineLoop;
  private lastOpts: BoardOpts = {};

  constructor(private state: GameState) {
    this.size = state.map.hexSize;
    this.terrain = buildTerrain(state);
    this.group.add(this.terrain.group);
    this.group.add(this.wreckLayer);
    this.group.add(this.effectsLayer);
    this.group.add(this.fx);

    const pts: THREE.Vector3[] = hexCorners(this.size * 0.96).map((c) => new THREE.Vector3(c.x, 0, c.z));
    this.hoverRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xd8a03c, transparent: true, opacity: 0.85 }),
    );
    this.hoverRing.visible = false;
    this.group.add(this.hoverRing);
  }

  get bounds(): { min: THREE.Vector3; max: THREE.Vector3 } {
    return { min: this.terrain.min, max: this.terrain.max };
  }

  terrainMesh(): THREE.Object3D {
    return this.terrain.group.children.find((o) => o.name === "terrain")!;
  }

  /** Marker groups for unit picking (each carries userData.unitId). */
  unitGroups(): THREE.Object3D[] {
    return [...this.visuals.values()].map((v) => v.marker.group);
  }

  /** Is this unit currently drawn LIVE (not ghost/hidden) for the view side? */
  shownLive(id: number): boolean {
    const u = this.state.units.find((x) => x.id === id);
    if (!u) return false;
    const m = markerDataFor(this.state, u, this.lastOpts.viewSide);
    return m !== null && !m.ghost;
  }

  /** Reconcile unit visuals against state + fog. Cheap when nothing changed:
   *  a visual is rebuilt only when its appearance signature changes. */
  sync(opts: BoardOpts): void {
    this.lastOpts = opts;
    const seen = new Set<number>();
    for (const u of this.state.units) {
      const m = markerDataFor(this.state, u, opts.viewSide);
      if (!m) continue;
      seen.add(m.data.id);
      const showIntent = !m.ghost && unitType(u.typeId).cls === "mech" && (!opts.viewSide || u.side === opts.viewSide);
      const intent = showIntent ? bannerText(u.callSign, this.state.intents[u.id]) : undefined;
      const dim = opts.dim?.has(u.id) ?? false;
      const selected = opts.selectedId === m.data.id;
      const sig = [
        m.ghost ? "g" : "l",
        hexKey(m.data.hex),
        m.data.facing,
        m.data.structure,
        m.data.crits.join(","),
        m.data.inSupply ? 1 : 0,
        dim ? 1 : 0,
        selected ? 1 : 0,
        intent ?? "",
      ].join("|");

      const existing = this.visuals.get(m.data.id);
      if (existing && existing.sig === sig) continue;
      if (existing) {
        this.group.remove(existing.marker.group);
        disposeGroup(existing.marker.group);
      }
      const marker = buildUnitMarker(m.data, {
        size: this.size,
        lift: hexSurfaceY(this.state, m.data.hex),
        intent,
        dim,
        ghost: m.ghost,
        selected,
      });
      this.group.add(marker.group);
      this.visuals.set(m.data.id, { marker, sig });
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.group.remove(v.marker.group);
        disposeGroup(v.marker.group);
        this.visuals.delete(id);
      }
    }

    // Standing battlefield effects (smoke / fortifications), fog-aware.
    const effSig =
      this.state.effects.map((e) => `${e.kind}:${hexKey(e.hex)}:${e.expiresTurn}`).join("|") + `@${opts.viewSide ?? "all"}T${this.state.turn}`;
    if (effSig !== this.effectsSig) {
      this.effectsSig = effSig;
      this.effectsLayer.children.slice().forEach((c) => {
        this.effectsLayer.remove(c);
        disposeGroup(c);
      });
      this.effectsLayer.add(buildEffectsGroup(this.state, opts.viewSide));
    }
  }

  setHover(hex: Hex | null): void {
    if (!hex) {
      this.hoverRing.visible = false;
      return;
    }
    const c = hexToWorld(hex, this.size);
    this.hoverRing.position.set(c.x, hexSurfaceY(this.state, hex) + 0.06, c.z);
    this.hoverRing.visible = true;
  }

  /** Animate one sim event (fog-aware). Resolves when the presentation ends. */
  async play(ev: GameEvent): Promise<void> {
    switch (ev.kind) {
      case "move":
        return this.playMove(ev);
      case "face":
        return this.playFace(ev);
      case "fire":
        return this.playFire(ev);
      case "resupply":
        return this.playResupply(ev);
      case "mission":
        return this.playMission(ev);
      case "build":
        return this.playBuild(ev);
      case "mine":
        return this.playMine(ev);
      case "offmap":
        return this.playOffmap(ev);
      default:
        return; // turn/phase markers are log-only
    }
  }

  /** Air activity: a fast jet streak over the target, then the payload — a
   *  hammering of flashes (strike, with deaths resolved) or a sweeping blue
   *  sensor ring (recon overflight). */
  private async playOffmap(ev: Extract<GameEvent, { kind: "offmap" }>): Promise<void> {
    const c = hexToWorld(ev.at, this.size);
    const y = this.groundY(ev.at) + 6.5;
    // The flyby: a slim dart crossing the footprint, west→east for blue, mirrored for red.
    const dirSign = ev.side === "blue" ? 1 : -1;
    const jet = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.9, 6),
      new THREE.MeshBasicMaterial({ color: ev.side === "blue" ? 0x5d9ec9 : 0xc4554a }),
    );
    jet.rotation.z = -dirSign * (Math.PI / 2); // nose along the flight path
    this.fx.add(jet);
    const span = 16;
    await tween(420, (t) => {
      jet.position.set(c.x + dirSign * (t * 2 - 1) * span, y + Math.sin(t * Math.PI) * 0.6, c.z);
    });
    this.fx.remove(jet);
    jet.geometry.dispose();
    (jet.material as THREE.Material).dispose();

    if (ev.asset === "strike") {
      for (let i = 0; i < ev.hexes.length; i++) {
        const h = ev.hexes[i];
        const w = hexToWorld(h, this.size);
        this.flash(new THREE.Vector3(w.x, this.groundY(h) + 0.5, w.z), 0xff8a3a, 0.42, 240);
        if (i % 2 === 1) await delay(60);
      }
      await delay(160);
      for (const hit of ev.hits) {
        const u = this.state.units.find((x) => x.id === hit.id);
        if (!u) continue;
        if (hit.damage > 0) this.floatText(u.hex, `${hit.damage} dmg`, "#d8a03c");
        if (hit.destroyed) {
          this.floatText(u.hex, "DESTROYED", "#c4554a", 1.0);
          await this.playDeath(hit.id, u.hex);
        }
      }
      await delay(180);
    } else {
      // The sensor sweep: an expanding ring the size of the coverage.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.55, 32),
        new THREE.MeshBasicMaterial({ color: 0x5d9ec9, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(c.x, this.groundY(ev.at) + 0.15, c.z);
      this.fx.add(ring);
      this.floatText(ev.at, "RECON OVERFLIGHT", "#7ab0d4");
      await tween(520, (t) => {
        ring.scale.setScalar(1 + t * 7);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - t);
      });
      this.fx.remove(ring);
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
    }
  }

  /** An area mission: a rolling barrage of flashes across the footprint, then
   *  the outcome text (suppression markers / the smoke standing up via sync). */
  private async playMission(ev: Extract<GameEvent, { kind: "mission" }>): Promise<void> {
    const color = ev.mission === "suppress" ? 0xffa24a : 0xb8c2cc;
    for (let i = 0; i < ev.hexes.length; i++) {
      const h = ev.hexes[i];
      const c = hexToWorld(h, this.size);
      this.flash(new THREE.Vector3(c.x, this.groundY(h) + 0.5, c.z), color, 0.3, 220);
      if (i % 2 === 1) await delay(70); // the barrage walks across the area
    }
    await delay(160);
    if (ev.mission === "suppress") {
      for (const id of ev.suppressedIds) {
        const u = this.state.units.find((x) => x.id === id);
        if (u && (this.shownLive(id) || u.side === this.lastOpts.viewSide)) this.floatText(u.hex, "SUPPRESSED", "#d8a03c");
      }
    } else {
      this.floatText(ev.at, "SMOKE SCREEN", "#9aa3a8");
    }
    await delay(220);
  }

  /** A mine strike: sharp flash under the victim, the verdict overhead. */
  private async playMine(ev: Extract<GameEvent, { kind: "mine" }>): Promise<void> {
    const c = hexToWorld(ev.at, this.size);
    this.flash(new THREE.Vector3(c.x, this.groundY(ev.at) + 0.35, c.z), 0xc4734a, 0.45, 260);
    await delay(160);
    this.floatText(ev.at, "MINE STRIKE", "#d8a03c");
    if (ev.destroyed) {
      this.floatText(ev.at, "DESTROYED", "#c4554a", 1.0);
      await this.playDeath(ev.id, ev.at);
    } else if (ev.damage > 0) {
      this.floatText(ev.at, `${ev.damage} dmg${ev.crit ? " · MOBILITY OUT" : ""}`, "#c4734a", 0.55);
    }
    await delay(220);
  }

  private async playBuild(ev: Extract<GameEvent, { kind: "build" }>): Promise<void> {
    if (!this.shownLive(ev.id) && this.state.units.find((u) => u.id === ev.id)?.side !== this.lastOpts.viewSide) return;
    this.floatText(ev.at, "FORTIFIED", "#d8a03c");
    await delay(260);
  }

  private visualOf(id: number): Visual | undefined {
    return this.visuals.get(id);
  }

  private groundY(hex: Hex): number {
    return hexSurfaceY(this.state, hex);
  }

  private async playMove(ev: Extract<GameEvent, { kind: "move" }>): Promise<void> {
    const v = this.visualOf(ev.id);
    if (!v || !this.shownLive(ev.id)) return; // unseen manoeuvre stays unseen
    const g = v.marker.group;
    const cls = this.state.units.find((u) => u.id === ev.id);
    const steps = [ev.from, ...ev.path];
    const walker = cls && ["mech", "infantry", "engineer"].includes(unitType(cls.typeId).cls);
    for (let i = 1; i < steps.length; i++) {
      const a = hexToWorld(steps[i - 1], this.size);
      const b = hexToWorld(steps[i], this.size);
      const ya = this.groundY(steps[i - 1]);
      const yb = this.groundY(steps[i]);
      // Face the direction of travel while moving.
      v.marker.model.group.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      await tween(MOVE_MS_PER_HEX, (t) => {
        g.position.set(a.x + (b.x - a.x) * t, ya + (yb - ya) * t + (walker ? Math.abs(Math.sin(t * Math.PI * 2)) * 0.06 : 0), a.z + (b.z - a.z) * t);
      });
    }
    // Settle into the ordered final facing.
    const target = facingAngle(steps[steps.length - 1], ev.facing, this.size);
    const from = v.marker.model.group.rotation.y;
    await tween(FACE_MS, (t) => {
      v.marker.model.group.rotation.y = from + shortestArc(from, target) * t;
    });
  }

  private async playFace(ev: Extract<GameEvent, { kind: "face" }>): Promise<void> {
    const v = this.visualOf(ev.id);
    if (!v || !this.shownLive(ev.id)) return;
    const u = this.state.units.find((x) => x.id === ev.id)!;
    const from = v.marker.model.group.rotation.y;
    const target = facingAngle(u.hex, ev.facing, this.size);
    await tween(FACE_MS * 1.6, (t) => {
      v.marker.model.group.rotation.y = from + shortestArc(from, target) * t;
    });
  }

  private async playFire(ev: Extract<GameEvent, { kind: "fire" }>): Promise<void> {
    const attacker = this.visualOf(ev.id);
    const attackerShown = !!attacker && this.shownLive(ev.id);
    const targetShown = this.shownLive(ev.targetId) || this.state.units.find((u) => u.id === ev.targetId)?.side === this.lastOpts.viewSide;
    if (!attackerShown && !targetShown) return; // a fight nobody saw

    const fromW = hexToWorld(ev.from, this.size);
    const atW = hexToWorld(ev.at, this.size);
    const src = new THREE.Vector3(fromW.x, this.groundY(ev.from) + 1.0, fromW.z);
    const dst = new THREE.Vector3(atW.x, this.groundY(ev.at) + 0.7, atW.z);

    if (attackerShown && attacker) {
      // Aim (turret if there is one, else the whole model), then recoil.
      const aimObj = attacker.marker.model.parts.turret ?? attacker.marker.model.group;
      const base = attacker.marker.model.parts.turret ? attacker.marker.model.group.rotation.y : 0;
      const want = Math.atan2(-(dst.z - src.z), dst.x - src.x) - base;
      const from = aimObj.rotation.y;
      await tween(120, (t) => {
        aimObj.rotation.y = from + shortestArc(from, want) * t;
      });
      const barrel = attacker.marker.model.parts.barrel;
      if (barrel) {
        const bx = barrel.position.x;
        void tween(180, (t) => {
          barrel.position.x = bx - Math.sin(t * Math.PI) * 0.07;
        });
      }
      const muzzle = attacker.marker.model.parts.muzzle;
      if (muzzle) {
        attacker.marker.group.updateMatrixWorld(true);
        muzzle.getWorldPosition(src);
      }
      this.flash(src, 0xffe2a0, 0.22, 110);
    }

    // Tracer (only meaningful when at least one end is known; always brief).
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: 0xfff0b0 }));
    this.fx.add(bolt);
    const dist = src.distanceTo(dst);
    await tween(Math.min(260, 60 + dist * 14), (t) => {
      bolt.position.lerpVectors(src, dst, t);
    }, easeOut);
    this.fx.remove(bolt);
    bolt.geometry.dispose();
    (bolt.material as THREE.Material).dispose();

    if (targetShown) {
      if (!ev.hit) {
        this.floatText(ev.at, "MISS", "#aab4c8");
      } else {
        this.flash(dst, ev.penetrated ? 0xffa24a : 0xc8d4ff, ev.penetrated ? 0.34 : 0.22, 160);
        const bits: string[] = [];
        if (ev.penetrated) bits.push(`${ev.damage} dmg · ${ev.arc} armour`);
        else bits.push("deflected");
        if (ev.suppression > 0) bits.push(`+${ev.suppression} supp`);
        this.floatText(ev.at, bits.join("  "), ev.penetrated ? "#d8a03c" : "#9aa3a8");
        if (ev.crit) this.floatText(ev.at, `CRIT — ${ev.crit}`, "#f0bc5c", 0.55);
        if (ev.destroyed) {
          this.floatText(ev.at, "DESTROYED", "#c4554a", 1.0);
          await this.playDeath(ev.targetId, ev.at);
        }
      }
      await delay(140); // beat between consecutive shots so volleys read
    }
  }

  private async playDeath(id: number, at: Hex): Promise<void> {
    const v = this.visualOf(id);
    const u = this.state.units.find((x) => x.id === id);
    const cls: UnitClass = u ? unitType(u.typeId).cls : "armor";
    if (v) {
      const g = v.marker.group;
      this.flash(new THREE.Vector3(g.position.x, g.position.y + 0.6, g.position.z), 0xff8a3a, 0.5, 260);
      await tween(380, (t) => {
        g.scale.setScalar(1.8 * (1 - 0.65 * t));
        g.rotation.z = 0.5 * t;
        g.position.y = Math.max(0, g.position.y - 0.2 * t);
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            m.transparent = true;
            m.opacity = 1 - t;
          }
        });
      });
      this.group.remove(g);
      disposeGroup(g);
      this.visuals.delete(id);
    }
    this.addWreck(id, cls, at);
  }

  /** A witnessed kill leaves a wreck (persists for the rest of the match). */
  addWreck(id: number, cls: UnitClass, hex: Hex): void {
    if (this.wrecks.has(id)) return;
    const w = buildWreck(cls, id);
    const c = hexToWorld(hex, this.size);
    w.scale.setScalar(1.8);
    w.position.set(c.x, this.groundY(hex), c.z);
    this.wreckLayer.add(w);
    this.wrecks.set(id, w);
  }

  wreckCount(side?: Side): number {
    if (side === undefined) return this.wrecks.size;
    let n = 0;
    for (const id of this.wrecks.keys()) {
      const u = this.state.units.find((x) => x.id === id);
      if (u?.side === side) n++;
    }
    return n;
  }

  private async playResupply(ev: Extract<GameEvent, { kind: "resupply" }>): Promise<void> {
    const target = this.state.units.find((u) => u.id === ev.targetId);
    if (!target || !this.shownLive(ev.targetId)) return;
    const c = hexToWorld(target.hex, this.size);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.3, 20),
      new THREE.MeshBasicMaterial({ color: 0x6a8e5d, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(c.x, this.groundY(target.hex) + 0.08, c.z);
    this.fx.add(ring);
    const parts: string[] = [];
    if (ev.ammo > 0) parts.push(`+${ev.ammo} ammo`);
    if (ev.fuel > 0) parts.push(`+${ev.fuel} fuel`);
    this.floatText(target.hex, parts.join("  ") || "resupplied", "#8eb07a");
    await tween(360, (t) => {
      ring.scale.setScalar(1 + t * 2.4);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    });
    this.fx.remove(ring);
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
  }

  /** Rising, fading combat text over a hex. Fire-and-forget. */
  floatText(hex: Hex, text: string, color: string, extraLift = 0): void {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 56;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 26px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = 6;
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 28, 248);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const c = hexToWorld(hex, this.size);
    const y0 = this.groundY(hex) + 1.6 + extraLift;
    sprite.position.set(c.x, y0, c.z);
    sprite.scale.set(3.4, 0.75, 1);
    this.fx.add(sprite);
    void tween(950, (t) => {
      sprite.position.y = y0 + t * 1.1;
      sprite.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }).then(() => {
      this.fx.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    });
  }

  /** A brief additive flash (muzzle, impact, kill). Fire-and-forget. */
  private flash(at: THREE.Vector3, color: number, size: number, ms: number): void {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(size, 10, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    m.position.copy(at);
    this.fx.add(m);
    void tween(ms, (t) => {
      m.scale.setScalar(1 + t * 1.6);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
    }).then(() => {
      this.fx.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
  }

  dispose(): void {
    disposeGroup(this.group);
  }
}

/** Signed shortest rotation from `from` to `to` (radians). */
function shortestArc(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Free GPU resources for a discarded group. Disposing a material does NOT
 *  dispose its texture, and badges/banners/labels are fresh CanvasTextures —
 *  without this, rebuilds leak GPU textures. Sprites share one module-level
 *  geometry across ALL sprites, which must never be disposed. */
export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !(o instanceof THREE.Sprite)) mesh.geometry.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of mats) {
      const map = (m as THREE.Material & { map?: THREE.Texture | null }).map;
      if (map) map.dispose();
      m.dispose();
    }
  });
}
