import * as THREE from "three";
import { CELL, COVER_HEIGHT, WALL_HEIGHT } from "../config/balance";
import type { ThemeDef } from "../config/runConfig";
import { Level, TILE_COVER, TILE_HAZARD, TILE_WALL } from "../sim/level";

// Render twin of the tile grid: a flat floor plus instanced boxes for walls and
// cover (their height gives the 2.5D depth under the tilt cam) and glowing flat
// tiles for hazards. Reads the same Level the sim collides against, so what you
// see is exactly what blocks movement and fire.

function countTiles(level: Level, type: number): number {
  let n = 0;
  for (let i = 0; i < level.tiles.length; i++) if (level.tiles[i] === type) n++;
  return n;
}

function instancedBoxes(
  level: Level,
  type: number,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  y: number,
): THREE.InstancedMesh | null {
  const count = countTiles(level, type);
  if (count === 0) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let cz = 0; cz < level.rows; cz++) {
    for (let cx = 0; cx < level.cols; cx++) {
      if (level.tileAtCell(cx, cz) !== type) continue;
      m.makeTranslation(level.worldX(cx), y, level.worldZ(cz));
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.castShadow = type !== TILE_HAZARD;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export function buildLevelMeshes(level: Level, theme: ThemeDef): THREE.Group {
  const group = new THREE.Group();
  const worldW = level.cols * CELL;
  const worldH = level.rows * CELL;

  const floorGeo = new THREE.PlaneGeometry(worldW, worldH);
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(
    floorGeo,
    new THREE.MeshStandardMaterial({ color: theme.palette.floor, roughness: 0.96 }),
  );
  floor.receiveShadow = true;
  group.add(floor);

  const wall = instancedBoxes(
    level,
    TILE_WALL,
    new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL),
    new THREE.MeshStandardMaterial({ color: theme.palette.wall, roughness: 0.85 }),
    WALL_HEIGHT / 2,
  );
  if (wall) group.add(wall);

  const cover = instancedBoxes(
    level,
    TILE_COVER,
    new THREE.BoxGeometry(CELL * 0.82, COVER_HEIGHT, CELL * 0.82),
    new THREE.MeshStandardMaterial({ color: theme.palette.cover, roughness: 0.7 }),
    COVER_HEIGHT / 2,
  );
  if (cover) group.add(cover);

  const hazard = instancedBoxes(
    level,
    TILE_HAZARD,
    new THREE.BoxGeometry(CELL, 0.08, CELL),
    new THREE.MeshStandardMaterial({
      color: theme.palette.hazard,
      emissive: theme.palette.hazard,
      emissiveIntensity: 0.9,
      roughness: 0.5,
    }),
    0.04,
  );
  if (hazard) group.add(hazard);

  return group;
}
