/* Cuts meshes that are too big for a printer into pieces that fit its build volume.
   Every cut face is capped, so each piece stays a closed solid, and matching pin holes can be
   added on both sides of a cut so the pieces line up when glued. Loaded on demand by converter-worker.js. */
import { ShapeUtils, Vector2 } from "/vendor/three@0.186.0/three.core.js";

// Distances are in millimetres.
const WELD = 1e4; // merge vertices closer than 0.1 micron
const ON_PLANE = 1e-4; // a vertex this close to a cut plane moves the plane slightly instead
const BED_MARGIN = 5; // room on each side of a piece for a brim or skirt
const PIN_WALL = 1.5; // minimum material around a pin hole
const PIN_SIDES = 24;

export const PIN_TYPES = {
  // A short length of 1.75 mm filament makes a good dowel.
  filament: { hole: 2.0, depth: 5 },
  // Printed pins, 0.2 mm smaller than the hole, delivered as their own STL.
  printed: { hole: 5.4, depth: 6, pin: 5.0 },
};

/* ---------- Mesh helpers ---------- */

class MeshBuilder {
  constructor() {
    this.pos = [];
    this.idx = [];
  }

  vertex(x, y, z) {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }

  tri(a, b, c) {
    this.idx.push(a, b, c);
  }

  /** Adds a triangle, flipped if needed so its normal points along hint. */
  orientedTri(a, b, c, hx, hy, hz) {
    const p = this.pos;
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const dot = (uy * vz - uz * vy) * hx + (uz * vx - ux * vz) * hy + (ux * vy - uy * vx) * hz;
    if (dot < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  build() {
    return this.idx.length ? withBounds({ pos: Float64Array.from(this.pos), idx: Uint32Array.from(this.idx) }) : null;
  }
}

function withBounds(mesh) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const { pos } = mesh;
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[i + k] < min[k]) min[k] = pos[i + k];
      if (pos[i + k] > max[k]) max[k] = pos[i + k];
    }
  }
  return Object.assign(mesh, { min, max });
}

/** OpenCascade writes each face with its own vertices. Merge shared ones so cuts can follow edges between faces. */
function weld(positions, indices) {
  const map = new Map();
  const remap = new Uint32Array(positions.length / 3);
  const pos = [];
  for (let i = 0; i < remap.length; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      pos.push(x, y, z);
      map.set(key, id);
    }
    remap[i] = id;
  }
  const idx = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = remap[indices[t]], b = remap[indices[t + 1]], c = remap[indices[t + 2]];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  return withBounds({ pos: Float64Array.from(pos), idx: Uint32Array.from(idx) });
}

/* ---------- 2D geometry for the cut faces ---------- */

function signedArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2;
}

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToEdges(x, y, loops) {
  let best = Infinity;
  for (const pts of loops) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len)) : 0;
      const d = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
      if (d < best) best = d;
    }
  }
  return best;
}

/** Groups closed cut outlines into regions: an outer boundary plus the holes directly inside it. */
function nestLoops(loops) {
  const boxes = loops.map(({ pts }) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    return { x0, y0, x1, y1 };
  });
  const contains = (outer, inner) => {
    const b = boxes[outer], p = loops[inner].pts[0];
    return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && pointInPolygon(p.x, p.y, loops[outer].pts);
  };
  const parents = loops.map((_, i) => loops.map((_, j) => j).filter((j) => j !== i && contains(j, i)));
  const depth = parents.map((p) => p.length);

  const regions = new Map();
  loops.forEach((loop, i) => {
    if (depth[i] % 2 === 0) regions.set(i, { outer: loop, holes: [] });
  });
  loops.forEach((loop, i) => {
    if (depth[i] % 2 === 0) return;
    const parent = parents[i].find((j) => depth[j] === depth[i] - 1);
    if (parent !== undefined) regions.get(parent).holes.push(loop);
  });
  return [...regions.values()];
}

/* ---------- Pin placement ---------- */

/** Separating axis test between a triangle and an axis-aligned box (Akenine-Moller). */
function triBoxOverlap(center, half, v0, v1, v2) {
  const a = [v0[0] - center[0], v0[1] - center[1], v0[2] - center[2]];
  const b = [v1[0] - center[0], v1[1] - center[1], v1[2] - center[2]];
  const c = [v2[0] - center[0], v2[1] - center[1], v2[2] - center[2]];
  for (let k = 0; k < 3; k++) {
    if (Math.min(a[k], b[k], c[k]) > half[k] || Math.max(a[k], b[k], c[k]) < -half[k]) return false;
  }
  const edges = [
    [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [c[0] - b[0], c[1] - b[1], c[2] - b[2]],
    [a[0] - c[0], a[1] - c[1], a[2] - c[2]],
  ];
  const n = [
    edges[0][1] * edges[1][2] - edges[0][2] * edges[1][1],
    edges[0][2] * edges[1][0] - edges[0][0] * edges[1][2],
    edges[0][0] * edges[1][1] - edges[0][1] * edges[1][0],
  ];
  const separated = (ax) => {
    const pa = a[0] * ax[0] + a[1] * ax[1] + a[2] * ax[2];
    const pb = b[0] * ax[0] + b[1] * ax[1] + b[2] * ax[2];
    const pc = c[0] * ax[0] + c[1] * ax[1] + c[2] * ax[2];
    const r = half[0] * Math.abs(ax[0]) + half[1] * Math.abs(ax[1]) + half[2] * Math.abs(ax[2]);
    return Math.min(pa, pb, pc) > r || Math.max(pa, pb, pc) < -r;
  };
  if (separated(n)) return false;
  for (const e of edges) {
    if (separated([0, -e[2], e[1]]) || separated([e[2], 0, -e[0]]) || separated([-e[1], e[0], 0])) return false;
  }
  return true;
}

/** True when a pin hole of the given size fits at (u, v) on both sides of the cut without breaking through any surface. */
function pinFits(mesh, axis, at, u, v, pin) {
  const ua = (axis + 1) % 3, va = (axis + 2) % 3;
  const r = pin.hole / 2 + 0.3;
  const center = [0, 0, 0], half = [0, 0, 0];
  center[axis] = at; half[axis] = pin.depth + 0.3;
  center[ua] = u; half[ua] = r;
  center[va] = v; half[va] = r;
  const { pos, idx } = mesh;
  const p = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  for (let t = 0; t < idx.length; t += 3) {
    if (triBoxOverlap(center, half, p(idx[t]), p(idx[t + 1]), p(idx[t + 2]))) return false;
  }
  return true;
}

/** Picks up to two pin positions in a region of the cut, far apart so the pieces cannot twist. */
function placePins(mesh, axis, at, region, pin) {
  const loops = [region.outer.pts, ...region.holes.map((h) => h.pts)];
  const clearance = pin.hole / 2 + PIN_WALL;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0;
  for (const p of region.outer.pts) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    cx += p.x; cy += p.y;
  }
  if (x1 - x0 < clearance * 2 || y1 - y0 < clearance * 2) return [];
  cx /= region.outer.pts.length; cy /= region.outer.pts.length;

  const step = Math.max((x1 - x0) / 16, (y1 - y0) / 16, pin.hole / 2);
  const candidates = [];
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      if (!pointInPolygon(x, y, region.outer.pts)) continue;
      if (region.holes.some((h) => pointInPolygon(x, y, h.pts))) continue;
      const room = distanceToEdges(x, y, loops);
      if (room >= clearance) candidates.push({ x, y, room });
    }
  }
  if (!candidates.length) return [];

  const fits = (c) => (c.ok ??= pinFits(mesh, axis, at, c.x, c.y, pin));
  const farthestFrom = (x, y) => [...candidates].sort((a, b) => Math.hypot(b.x - x, b.y - y) - Math.hypot(a.x - x, a.y - y));

  const first = farthestFrom(cx, cy).slice(0, 24).find(fits);
  if (first) {
    const second = farthestFrom(first.x, first.y)
      .filter((c) => Math.hypot(c.x - first.x, c.y - first.y) >= clearance * 3)
      .slice(0, 24)
      .find(fits);
    if (second) return [first, second];
  }
  // Too small for two pins: one in the roomiest spot, if it fits.
  const single = [...candidates].sort((a, b) => b.room - a.room).slice(0, 12).find(fits);
  return single ? [single] : [];
}

/* ---------- Cutting ---------- */

/** Splits a closed mesh with the plane where coordinate `axis` equals `at`. Returns the pieces below and above it. */
function splitMesh(mesh, axis, at, pin) {
  if (mesh.max[axis] <= at) return { below: mesh, above: null, pins: 0 };
  if (mesh.min[axis] >= at) return { below: null, above: mesh, pins: 0 };

  const { pos, idx } = mesh;
  const nv = pos.length / 3;
  const d = new Float64Array(nv);
  // Keep every vertex off the plane, so each crossing edge has exactly one cut point.
  for (let tries = 0; ; tries++) {
    let onPlane = false;
    for (let i = 0; i < nv; i++) {
      d[i] = pos[i * 3 + axis] - at;
      if (Math.abs(d[i]) < ON_PLANE) { onPlane = true; break; }
    }
    if (!onPlane || tries > 50) break;
    at += ON_PLANE * 10 * (tries + 1) * (tries % 2 ? -1 : 1);
  }

  const below = new MeshBuilder(), above = new MeshBuilder();
  const mapBelow = new Int32Array(nv).fill(-1), mapAbove = new Int32Array(nv).fill(-1);
  const vert = (i, side) => {
    const map = side === below ? mapBelow : mapAbove;
    if (map[i] < 0) map[i] = side.vertex(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    return map[i];
  };

  // Cut points are shared by the two triangles on either side of an edge, which keeps both pieces closed.
  const cutIds = new Map();
  const cutPos = [], cutBelow = [], cutAbove = [];
  const cutPoint = (a, b) => {
    const key = a < b ? a * nv + b : b * nv + a;
    let id = cutIds.get(key);
    if (id === undefined) {
      const t = d[a] / (d[a] - d[b]);
      const p = [0, 1, 2].map((k) => pos[a * 3 + k] + t * (pos[b * 3 + k] - pos[a * 3 + k]));
      p[axis] = at;
      id = cutPos.length;
      cutPos.push(p);
      cutBelow.push(below.vertex(...p));
      cutAbove.push(above.vertex(...p));
      cutIds.set(key, id);
    }
    return id;
  };
  const cutVert = (id, side) => (side === below ? cutBelow[id] : cutAbove[id]);

  const segments = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const sa = d[a] > 0, sb = d[b] > 0, sc = d[c] > 0;
    if (sa === sb && sb === sc) {
      const side = sa ? above : below;
      side.tri(vert(a, side), vert(b, side), vert(c, side));
      continue;
    }
    // Rotate so p is the vertex alone on its side, keeping the winding.
    const [p, q, r] = sa !== sb && sa !== sc ? [a, b, c] : sb !== sa ? [b, c, a] : [c, a, b];
    const pq = cutPoint(p, q), pr = cutPoint(p, r);
    const lone = d[p] > 0 ? above : below, rest = lone === above ? below : above;
    lone.tri(vert(p, lone), cutVert(pq, lone), cutVert(pr, lone));
    rest.tri(cutVert(pq, rest), vert(q, rest), vert(r, rest));
    rest.tri(cutVert(pq, rest), vert(r, rest), cutVert(pr, rest));
    segments.push(pq, pr);
  }

  // Chain the cut segments into closed outlines.
  const adj = new Int32Array(cutPos.length * 2).fill(-1);
  const link = (a, b) => {
    if (adj[a * 2] < 0) adj[a * 2] = b;
    else if (adj[a * 2 + 1] < 0) adj[a * 2 + 1] = b;
  };
  for (let s = 0; s < segments.length; s += 2) {
    link(segments[s], segments[s + 1]);
    link(segments[s + 1], segments[s]);
  }
  const ua = (axis + 1) % 3, va = (axis + 2) % 3;
  const visited = new Uint8Array(cutPos.length);
  const loops = [];
  for (let start = 0; start < cutPos.length; start++) {
    if (visited[start]) continue;
    const ids = [start];
    visited[start] = 1;
    for (let cur = start; ; ) {
      const n0 = adj[cur * 2], n1 = adj[cur * 2 + 1];
      const next = n0 >= 0 && !visited[n0] ? n0 : n1 >= 0 && !visited[n1] ? n1 : -1;
      if (next < 0) break;
      visited[next] = 1;
      ids.push(next);
      cur = next;
    }
    while (ids.length > 3 && cutPos[ids[0]].every((v, k) => v === cutPos[ids[ids.length - 1]][k])) ids.pop();
    if (ids.length < 3) continue;
    const pts = ids.map((id) => new Vector2(cutPos[id][ua], cutPos[id][va]));
    if (Math.abs(signedArea(pts)) > 1e-9) loops.push({ ids, pts });
  }

  // Cap the cut on both pieces. The piece below faces +axis at the cut, the piece above faces -axis.
  const hint = [0, 0, 0];
  hint[axis] = 1;
  let pins = 0;
  for (const region of nestLoops(loops)) {
    const contour = region.outer.pts.slice();
    const holes = region.holes.map((h) => h.pts.slice());
    const belowIds = [...region.outer.ids, ...region.holes.flatMap((h) => h.ids)].map((id) => cutBelow[id]);
    const aboveIds = [...region.outer.ids, ...region.holes.flatMap((h) => h.ids)].map((id) => cutAbove[id]);

    for (const spot of pin ? placePins(mesh, axis, at, region, pin) : []) {
      const ring = addPinHole(below, above, axis, at, spot, pin);
      holes.push(ring.pts);
      belowIds.push(...ring.below);
      aboveIds.push(...ring.above);
      pins++;
    }

    for (const [i, j, k] of ShapeUtils.triangulateShape(contour, holes)) {
      below.orientedTri(belowIds[i], belowIds[j], belowIds[k], hint[0], hint[1], hint[2]);
      above.orientedTri(aboveIds[i], aboveIds[j], aboveIds[k], -hint[0], -hint[1], -hint[2]);
    }
  }

  return { below: below.build(), above: above.build(), pins };
}

/** Adds a blind pin hole to both pieces and returns the outline to leave open in the caps. */
function addPinHole(below, above, axis, at, spot, pin) {
  const ua = (axis + 1) % 3, va = (axis + 2) % 3;
  // Size the polygon so a round pin of the full hole diameter fits inside it.
  const r = pin.hole / 2 / Math.cos(Math.PI / PIN_SIDES);
  const point = (u, v, level) => {
    const p = [0, 0, 0];
    p[axis] = level; p[ua] = u; p[va] = v;
    return p;
  };
  const pts = [], ring = [];
  for (let k = 0; k < PIN_SIDES; k++) {
    const a = (k / PIN_SIDES) * Math.PI * 2;
    const u = spot.x + r * Math.cos(a), v = spot.y + r * Math.sin(a);
    pts.push(new Vector2(u, v));
    ring.push([u, v]);
  }

  const result = { pts, below: [], above: [] };
  for (const [side, dir, ids] of [[below, -1, result.below], [above, 1, result.above]]) {
    const bottom = at + dir * pin.depth;
    const top = ring.map(([u, v]) => side.vertex(...point(u, v, at)));
    const floor = ring.map(([u, v]) => side.vertex(...point(u, v, bottom)));
    const mid = side.vertex(...point(spot.x, spot.y, bottom));
    ids.push(...top);
    for (let k = 0; k < PIN_SIDES; k++) {
      const n = (k + 1) % PIN_SIDES;
      // Walls face the hole's centre line, the floor faces out of the hole.
      const [u, v] = ring[k];
      const h = point(spot.x - u, spot.y - v, 0);
      side.orientedTri(top[k], top[n], floor[n], ...h);
      side.orientedTri(top[k], floor[n], floor[k], ...h);
      side.orientedTri(mid, floor[k], floor[n], ...point(0, 0, -dir));
    }
  }
  return result;
}

/* ---------- Planning the cuts ---------- */

/** Plans an even grid of cuts so every piece fits the bed in some axis-aligned orientation. */
function planCuts(min, max, bed) {
  const size = [0, 1, 2].map((k) => max[k] - min[k]);
  const usable = [bed[0] - BED_MARGIN * 2, bed[1] - BED_MARGIN * 2, bed[2]].map((v) => Math.max(v, 10));
  // Match the longest side of the part with the longest side of the bed, and so on.
  const partOrder = [0, 1, 2].sort((a, b) => size[b] - size[a]);
  const bedSorted = [...usable].sort((a, b) => b - a);
  const planes = [[], [], []];
  partOrder.forEach((axis, rank) => {
    const n = Math.max(1, Math.ceil(size[axis] / bedSorted[rank] - 1e-9));
    for (let i = 1; i < n; i++) planes[axis].push(min[axis] + (size[axis] * i) / n);
  });
  return planes;
}

function unionBounds(meshes) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], m.min[k]);
      max[k] = Math.max(max[k], m.max[k]);
    }
  }
  return { min, max };
}

/** Cuts a group of bodies with one shared grid. Returns the pieces in reading order, each a list of meshes. */
function cutGroup(meshes, bed, pin) {
  const { min, max } = unionBounds(meshes);
  const planes = planCuts(min, max, bed);
  const counts = planes.map((p) => p.length + 1);
  const cells = new Map();
  let pins = 0;

  for (const mesh of meshes) {
    let pieces = [mesh];
    for (let axis = 0; axis < 3; axis++) {
      for (const at of planes[axis]) {
        pieces = pieces.flatMap((piece) => {
          const res = splitMesh(piece, axis, at, pin);
          pins += res.pins;
          return [res.below, res.above].filter(Boolean);
        });
      }
    }
    for (const piece of pieces) {
      const cell = [0, 1, 2].map((k) => planes[k].filter((at) => at < (piece.min[k] + piece.max[k]) / 2).length);
      const key = cell[2] * counts[0] * counts[1] + cell[1] * counts[0] + cell[0];
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(piece);
    }
  }
  const pieces = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m);
  return { pieces, pins };
}

/** A set of printable pins, standing upright in a grid. */
function pinSet(count, pin) {
  const out = new MeshBuilder();
  const r = pin.pin / 2, length = pin.depth * 2 - 1, chamfer = 0.4;
  const cols = Math.ceil(Math.sqrt(count)), gap = pin.pin + 5;
  for (let n = 0; n < count; n++) {
    const cx = (n % cols) * gap, cy = Math.floor(n / cols) * gap;
    // Chamfered ends help the pin start into its hole.
    const levels = [[0, r - chamfer], [chamfer, r], [length - chamfer, r], [length, r - chamfer]];
    const rings = levels.map(([z, rr]) =>
      Array.from({ length: PIN_SIDES }, (_, k) => {
        const a = (k / PIN_SIDES) * Math.PI * 2;
        return out.vertex(cx + rr * Math.cos(a), cy + rr * Math.sin(a), z);
      })
    );
    const bottom = out.vertex(cx, cy, 0), top = out.vertex(cx, cy, length);
    for (let k = 0; k < PIN_SIDES; k++) {
      const n2 = (k + 1) % PIN_SIDES;
      const a = (k / PIN_SIDES) * Math.PI * 2;
      for (let l = 0; l + 1 < rings.length; l++) {
        const zDir = l === 0 ? -1 : l === rings.length - 2 ? 1 : 0;
        const h = [Math.cos(a), Math.sin(a), zDir];
        out.orientedTri(rings[l][k], rings[l][n2], rings[l + 1][n2], ...h);
        out.orientedTri(rings[l][k], rings[l + 1][n2], rings[l + 1][k], ...h);
      }
      out.orientedTri(bottom, rings[0][k], rings[0][n2], 0, 0, -1);
      out.orientedTri(top, rings[3][k], rings[3][n2], 0, 0, 1);
    }
  }
  return out.build();
}

/* ---------- Entry point ---------- */

/**
 * bodies: [{ name, positions, indices }] in millimetres.
 * options: { bed: [x, y, z], pins: "none" | "filament" | "printed", perBody: boolean }
 * Returns { groups: [{ name, pieces: [[mesh]] }], pins, pinSet }, where each mesh is { positions, indices }.
 * Groups that fit the bed come back as a single piece.
 */
export function cutToFit(bodies, options) {
  const pin = PIN_TYPES[options.pins] || null;
  const welded = bodies.map((b) => ({ name: b.name, mesh: weld(b.positions, b.indices) }));
  const groups = options.perBody ? welded.map((b) => ({ name: b.name, meshes: [b.mesh] })) : [{ name: null, meshes: welded.map((b) => b.mesh) }];

  let pins = 0;
  const out = groups.map((g) => {
    const res = cutGroup(g.meshes, options.bed, pin);
    pins += res.pins;
    return {
      name: g.name,
      pieces: res.pieces.map((meshes) => meshes.map((m) => ({ positions: m.pos, indices: m.idx }))),
    };
  });

  // Each pin joins two holes, one on each side of a cut.
  const set = pin && pin.pin && pins ? pinSet(pins, pin) : null;
  return { groups: out, pins, pinSet: set && { positions: set.pos, indices: set.idx } };
}
