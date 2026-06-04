import * as THREE from "three";

// Procedural sprite textures drawn to a canvas — no asset files needed for M1.
// Soft radial blobs read clearly as billboards against the 3D terrain.

function canvas(size = 64): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { c, ctx };
}

/** Soft-edged radial disc fading from `inner` (center) to transparent `outer`. */
export function discTexture(inner: string, outer: string): THREE.CanvasTexture {
  const { c, ctx } = canvas();
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, outer);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A bright ring/blade glyph for orbiting aura weapons. */
export function bladeTexture(color: string): THREE.CanvasTexture {
  const { c, ctx } = canvas();
  const glow = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  glow.addColorStop(0, "rgba(255,255,255,0.95)");
  glow.addColorStop(0.4, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 32, 16, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A bright four-point gem glyph for XP pickups. */
export function gemTexture(color: string): THREE.CanvasTexture {
  const { c, ctx } = canvas();
  const glow = ctx.createRadialGradient(32, 32, 1, 32, 32, 26);
  glow.addColorStop(0, color);
  glow.addColorStop(0.5, color);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.moveTo(32, 12);
  ctx.lineTo(48, 32);
  ctx.lineTo(32, 52);
  ctx.lineTo(16, 32);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
