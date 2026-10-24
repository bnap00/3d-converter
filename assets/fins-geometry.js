/*
  Stabilizer fins: geometry. No DOM and no three.js, so tools/test-fins.mjs can run it in Node.

  A mesh is a Float32Array of triangles, 9 floats each (x, y, z per corner), in millimetres,
  Z up, sitting on the bed at z = 0.

  A fin is a buttress for a tall, thin part: a vertical plate standing edge-on to one of the
  part's sides, deep at the bed and narrow at the top, so the part cannot tip towards or away
  from it. Its inner edge follows the part at a small gap, and one-layer-tall horizontal tines
  bridge that gap into the part, so the fin holds the part both ways. Pair fins on opposite
  sides and the part cannot fall over at all. The fins snap off once the print is done.

  Coordinates for one fin: d is the outward direction (towards the fin), t is across the fin's
  thickness, z is up. "v" is a position along d and "u" a position along t.
*/

export const DEFAULTS = {
  heightPct: 60,    // fin height as % of the part height
  depthPct: 35,     // fin depth at the bed as % of the fin height
  thickness: 1.2,   // three 0.4 mm lines
  gap: 0.2,         // standoff between fin and part, like slicer supports
  layerH: 0.2,      // tine height; must match the slicer's layer height
  tineSpacing: 5,   // mm between tines up the fin
};

export const FIN = {
  dz: 0.5,          // profile sampling step
  minDepth: 2.5,    // the fin is never thinner than this, front to back
  topDepth: 3,      // a flat top, not a point
  minDepthMm: 6,
  maxDepthMm: 60,
  topClear: 0.5,    // stop this far below the top of the part's surface at the fin
  minHeight: 5,
  tineW: 0.5,       // one bead
  tineStart: 1,     // first tine this high, clear of the first layer and its squish
  tineOverlap: 0.3, // tine sinks this far back into the fin
  tineBite: 0.1,    // ...and this far into the part, so the slicer merges them
  tineSpanMax: 1.5, // past this much open air a tine is a bridge, so skip it
  footH: 0.6,
  footWing: 3,      // flange past the fin on each side
  footPad: 3,       // ...and past its outer end
  earR: 5,          // round pad at the outer end, for bed grip
  earH: 0.4,
};

/* ---------- STL in and out ---------- */

export function parseStl(buffer) {
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : -1;
  const readBinary = () => {
    const tris = new Float32Array(count * 9);
    for (let i = 0, o = 84; i < count; i++, o += 50) {
      for (let k = 0; k < 9; k++) tris[i * 9 + k] = view.getFloat32(o + 12 + k * 4, true);
    }
    return tris;
  };
  if (count >= 0 && 84 + count * 50 === buffer.byteLength) return readBinary();
  // ASCII: every "vertex x y z" line, three per facet. Some exporters write it in capitals.
  const text = new TextDecoder().decode(buffer);
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
  const out = [];
  for (let m; (m = re.exec(text)); ) out.push(+m[1], +m[2], +m[3]);
  const n = Math.floor(out.length / 9);
  if (n) return new Float32Array(out.slice(0, n * 9));
  // Binary with padding after the last triangle, which some exporters leave.
  if (count > 0 && 84 + count * 50 <= buffer.byteLength) return readBinary();
  throw new Error("This STL has no triangles, or it is not a valid STL file.");
}

export function writeStl(parts, header = "stabilizer fins") {
  const count = parts.reduce((s, p) => s + p.length / 9, 0);
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  // 80 bytes, not 80 characters: a name in another script can take 3 bytes a character.
  new Uint8Array(buffer, 0, 80).set(new TextEncoder().encode(String(header)).subarray(0, 80));
  view.setUint32(80, count, true);
  let o = 84;
  for (const p of parts) {
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      view.setFloat32(o, nx / len, true); view.setFloat32(o + 4, ny / len, true); view.setFloat32(o + 8, nz / len, true);
      for (let k = 0; k < 9; k++) view.setFloat32(o + 12 + k * 4, p[i + k], true);
      view.setUint16(o + 48, 0, true);
      o += 50;
    }
  }
  return buffer;
}

/* ---------- Placing the part ---------- */

/** Rotate a quarter turn about "x", "y" or "z" (right-handed). Returns a new array. */
export function rotate90(tris, axis) {
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (axis === "x") { out[i] = x; out[i + 1] = -z; out[i + 2] = y; }
    else if (axis === "y") { out[i] = z; out[i + 1] = y; out[i + 2] = -x; }
    else { out[i] = -y; out[i + 1] = x; out[i + 2] = z; }
  }
  return out;
}

/** Put the lowest point on the bed and centre the part over the origin. In place. */
export function seat(tris) {
  const b = bounds(tris);
  const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  for (let i = 0; i < tris.length; i += 3) {
    tris[i] -= cx; tris[i + 1] -= cy; tris[i + 2] -= b.min[2];
  }
  return tris;
}

export function bounds(tris) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/* ---------- Analysis: how likely is it to tip, and which way is thin? ---------- */

function hull2d(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function extent(points, ax) {
  let lo = Infinity, hi = -Infinity;
  for (const p of points) {
    const s = p[0] * ax[0] + p[1] * ax[1];
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  return [lo, hi];
}

export function analyze(tris) {
  const b = bounds(tris);
  const height = b.max[2] - b.min[2];
  // Thin out a huge mesh: the outline only needs a sample of the vertices, plus every
  // vertex touching the bed.
  const step = Math.max(1, Math.floor(tris.length / 3 / 200000)) * 3;
  const all = [], base = [];
  for (let i = 0; i < tris.length; i += 3) {
    const onBed = tris[i + 2] - b.min[2] <= 0.25;
    if (onBed) base.push([tris[i], tris[i + 1]]);
    if (onBed || i % step === 0) all.push([tris[i], tris[i + 1]]);
  }
  const hull = hull2d(all);

  // Smallest-area rectangle around the outline: one side lies on a hull edge.
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-6) continue;
    const a = [(q[0] - p[0]) / len, (q[1] - p[1]) / len], c = [-a[1], a[0]];
    const ea = extent(hull, a), ec = extent(hull, c);
    const area = (ea[1] - ea[0]) * (ec[1] - ec[0]);
    if (!best || area < best.area) best = { area, a, c, ea, ec };
  }
  if (!best) best = { a: [1, 0], c: [0, 1], ea: [b.min[0], b.max[0]], ec: [b.min[1], b.max[1]] };
  let major = best.a, minor = best.c, emaj = best.ea, emin = best.ec;
  if (emaj[1] - emaj[0] < emin[1] - emin[0]) [major, minor, emaj, emin] = [minor, major, emin, emaj];
  // Point the axes at +x / +y where possible, so the readout does not flip sign at random.
  if (major[0] < -1e-9 || (Math.abs(major[0]) < 1e-9 && major[1] < 0)) { major = major.map((v) => -v); emaj = [-emaj[1], -emaj[0]]; }
  if (minor[0] * -major[1] + minor[1] * major[0] < 0) { minor = minor.map((v) => -v); emin = [-emin[1], -emin[0]]; }

  const baseHull = base.length ? hull2d(base) : [];
  const bmaj = baseHull.length ? extent(baseHull, major) : [0, 0];
  const bmin = baseHull.length ? extent(baseHull, minor) : [0, 0];
  const baseLength = Math.max(0.5, bmaj[1] - bmaj[0]);
  const baseWidth = Math.max(0.5, bmin[1] - bmin[0]);
  const ratio = height / baseWidth;

  return {
    height,
    length: emaj[1] - emaj[0],
    width: emin[1] - emin[0],
    baseLength,
    baseWidth,
    major, minor, emaj, emin, bmaj, bmin,
    ratio,
    ratioLong: height / baseLength,
    risk: ratio >= 4 ? "high" : ratio >= 2.5 ? "medium" : "low",
  };
}

/** The fins we suggest: pairs on both thin sides, plus the ends if the part is thin both ways. */
export function suggestFins(a) {
  const fins = [];
  const angleOf = (v) => Math.atan2(v[1], v[0]);
  const useBase = a.baseLength > 10;
  const [m0, m1] = useBase ? a.bmaj : a.emaj;
  const midMinor = useBase ? (a.bmin[0] + a.bmin[1]) / 2 : (a.emin[0] + a.emin[1]) / 2;
  const span = m1 - m0;
  const n = span <= 40 ? 1 : span <= 120 ? 2 : 3;
  const along = n === 1 ? [(m0 + m1) / 2] : Array.from({ length: n }, (_, i) => m0 + span * (0.12 + (0.76 * i) / (n - 1)));
  for (const side of [1, -1]) {
    const d = a.minor.map((v) => v * side);
    for (const s of along) {
      const p = [a.major[0] * s + a.minor[0] * midMinor, a.major[1] * s + a.minor[1] * midMinor];
      fins.push(finAt(angleOf(d), p));
    }
  }
  if (a.ratioLong >= 2.5) {
    const s = (m0 + m1) / 2;
    const p = [a.major[0] * s + a.minor[0] * midMinor, a.major[1] * s + a.minor[1] * midMinor];
    for (const side of [1, -1]) fins.push(finAt(angleOf(a.major.map((v) => v * side)), p));
  }
  return fins;
}

/** A fin facing `angle` (radians, in the bed plane) that passes through bed point p. */
export function finAt(angle, p) {
  const t = [-Math.sin(angle), Math.cos(angle)];
  return { angle, u: p[0] * t[0] + p[1] * t[1], height: null };
}

/* ---------- Building one fin ---------- */

/** Triangles near the fin's slice, projected into (u, z, v) for fast ray casts along -d. */
function slice(tris, d, t, u0, halfW, zTop) {
  const sel = [];
  for (let i = 0; i < tris.length; i += 9) {
    let umin = Infinity, umax = -Infinity, zmin = Infinity;
    for (let k = 0; k < 9; k += 3) {
      const u = tris[i + k] * t[0] + tris[i + k + 1] * t[1];
      if (u < umin) umin = u;
      if (u > umax) umax = u;
      if (tris[i + k + 2] < zmin) zmin = tris[i + k + 2];
    }
    if (umax < u0 - halfW || umin > u0 + halfW || zmin > zTop) continue;
    for (let k = 0; k < 9; k += 3) {
      const x = tris[i + k], y = tris[i + k + 1];
      sel.push(x * t[0] + y * t[1], tris[i + k + 2], x * d[0] + y * d[1]);
    }
  }
  const proj = new Float64Array(sel);
  // Bucket by z, 1 mm bins, so each ray only tests triangles at its height.
  const bins = new Map();
  for (let j = 0; j < proj.length; j += 9) {
    const z0 = Math.min(proj[j + 1], proj[j + 4], proj[j + 7]);
    const z1 = Math.max(proj[j + 1], proj[j + 4], proj[j + 7]);
    for (let b = Math.floor(z0); b <= Math.floor(z1); b++) {
      if (!bins.has(b)) bins.set(b, []);
      bins.get(b).push(j);
    }
  }
  /** The part's outermost point along d on the line (u, z), or -Infinity if the line misses it. */
  return (u, z) => {
    let best = -Infinity;
    for (const j of bins.get(Math.floor(z)) || []) {
      const au = proj[j], az = proj[j + 1], bu = proj[j + 3], bz = proj[j + 4], cu = proj[j + 6], cz = proj[j + 7];
      const det = (bz - cz) * (au - cu) + (cu - bu) * (az - cz);
      if (Math.abs(det) < 1e-12) continue; // edge-on to the ray; its neighbours cover it
      const l1 = ((bz - cz) * (u - cu) + (cu - bu) * (z - cz)) / det;
      const l2 = ((cz - az) * (u - cu) + (au - cu) * (z - cz)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const v = l1 * proj[j + 2] + l2 * proj[j + 5] + l3 * proj[j + 8];
      if (v > best) best = v;
    }
    return best;
  };
}

/** Outermost surface over a patch of the slice: several u across, a z window. */
function surfaceOver(probe, u0, halfW, z0, z1, du = 0.3) {
  let best = -Infinity;
  const nu = Math.max(1, Math.ceil((2 * halfW) / du));
  const nz = Math.max(1, Math.ceil((z1 - z0) / 0.25));
  for (let i = 0; i <= nu; i++) {
    const u = u0 - halfW + (2 * halfW * i) / nu;
    for (let k = 0; k <= nz; k++) {
      const v = probe(u, Math.max(0.001, z0 + ((z1 - z0) * k) / nz));
      if (v > best) best = v;
    }
  }
  return best;
}

/**
 * Build one fin. Returns { ok, reason?, tris, tines, height, depth } where tris is the fin
 * body, foot and tines as closed solids for the slicer to merge with the part.
 */
export function buildFin(tris, partHeight, fin, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const d = [Math.cos(fin.angle), Math.sin(fin.angle)];
  const t = [-d[1], d[0]];
  const half = o.thickness / 2;
  const wing = half + FIN.footWing;
  const wantH = fin.height ?? (partHeight * o.heightPct) / 100;
  const probe = slice(tris, d, t, fin.u, Math.max(wing, FIN.earR) + 0.5, wantH + FIN.dz + 1);

  // Inner edge: the part's outermost point at each height, plus the gap.
  const zs = [];
  for (let z = 0; z < wantH; z += FIN.dz) zs.push(z);
  zs.push(wantH);
  const surf = zs.map((z) => surfaceOver(probe, fin.u, half, z - FIN.dz, z + FIN.dz));
  let last = -1, first = -1;
  surf.forEach((s, i) => { if (s > -Infinity) { if (first < 0) first = i; last = i; } });
  if (first < 0) return fail("No part surface at this spot. Move the fin onto the part.");

  // Stop below the top of the part's side here: a fin above it holds nothing.
  // The window reaches dz above each sample, so the part is only known to reach zs[last] - dz.
  const topZ = last === zs.length - 1 ? wantH : zs[last] - FIN.dz - FIN.topClear;
  if (topZ < FIN.minHeight) return fail("The part is too short here for a fin.");
  const levels = zs.filter((z) => z < topZ - 1e-6).concat(topZ);
  const inner = [];
  let prev = null;
  for (let i = 0; i < levels.length; i++) {
    let s = surf[Math.min(i, surf.length - 1)];
    if (levels[i] === topZ && i < surf.length) s = Math.max(s, surfaceOver(probe, fin.u, half, topZ - FIN.dz, topZ + FIN.dz));
    if (s === -Infinity) s = prev !== null ? prev - o.gap : surf[first];
    let e = s + o.gap;
    // Moving in towards the part as it rises would overhang; hold it to 45 degrees.
    if (prev !== null) e = Math.max(e, prev - (levels[i] - levels[i - 1]));
    inner.push(e);
    prev = e;
  }

  // Outer edge: a straight taper from the base depth to a flat top.
  const depth = Math.min(FIN.maxDepthMm, Math.max(FIN.minDepthMm, (topZ * o.depthPct) / 100));
  const top = Math.min(FIN.topDepth, depth);
  const e0 = inner[0], eT = inner[inner.length - 1];
  const outer = levels.map((z, i) => {
    const line = e0 + depth + ((eT + top - (e0 + depth)) * z) / topZ;
    return Math.max(line, inner[i] + FIN.minDepth);
  });
  for (let i = 1; i < outer.length; i++) outer[i] = Math.max(outer[i], outer[i - 1] - (levels[i] - levels[i - 1]));

  const out = [];
  const toWorld = (v, u, z) => [d[0] * v + t[0] * u, d[1] * v + t[1] * u, z];
  plate(out, toWorld, levels, inner, outer, fin.u - half, fin.u + half);

  // Foot: a thin flange so the fin stays down, and a round ear at its outer end.
  const footIn = surfaceOver(probe, fin.u, wing, 0, FIN.footH + FIN.dz) + o.gap;
  const footOut = outer[0] + FIN.footPad;
  if (footOut - footIn > 2) box(out, toWorld, footIn, footOut, fin.u - wing, fin.u + wing, 0, FIN.footH);
  const earIn = surfaceOver(probe, fin.u, FIN.earR, 0, FIN.earH + FIN.dz) + o.gap;
  const earC = Math.max(outer[0], earIn + FIN.earR);
  disc(out, toWorld, earC, fin.u, FIN.earR, FIN.earH);

  // Tines: one layer tall, bridging the gap into the part.
  let tines = 0;
  const innerAt = (z) => {
    let i = 0;
    while (i < levels.length - 2 && levels[i + 1] < z) i++;
    const f = Math.min(1, Math.max(0, (z - levels[i]) / (levels[i + 1] - levels[i] || 1)));
    return inner[i] + (inner[i + 1] - inner[i]) * f;
  };
  const tw = FIN.tineW / 2;
  const z0 = Math.ceil(FIN.tineStart / o.layerH - 1e-6) * o.layerH;
  const every = Math.max(o.layerH, Math.round(o.tineSpacing / o.layerH) * o.layerH);
  for (let z = z0; z + o.layerH <= topZ - 0.5; z += every) {
    const zb = z + 0.02, zt = z + o.layerH - 0.02;
    const hits = [];
    for (const u of [fin.u - tw, fin.u, fin.u + tw]) for (const zz of [zb, zt]) hits.push(probe(u, zz));
    if (hits.some((h) => h === -Infinity)) continue;
    const reach = Math.min(...hits);
    const e = Math.max(innerAt(z), innerAt(z + o.layerH));
    if (e - reach > FIN.tineSpanMax) continue;
    box(out, toWorld, reach - FIN.tineBite, e + FIN.tineOverlap, fin.u - tw, fin.u + tw, z, z + o.layerH);
    tines++;
  }

  return { ok: true, tris: new Float32Array(out), tines, height: topZ, depth };

  function fail(reason) {
    return { ok: false, reason, tris: new Float32Array(0), tines: 0, height: 0, depth: 0 };
  }
}

/* ---------- Solids ---------- */

function tri(out, a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); }
function quad(out, a, b, c, d) { tri(out, a, b, c); tri(out, a, c, d); }

/** The fin body: a profile in (v, z) between inner and outer edges, extruded across u0..u1. */
function plate(out, W, zs, inner, outer, u0, u1) {
  const n = zs.length;
  for (let i = 0; i < n - 1; i++) {
    const z = zs[i], z2 = zs[i + 1];
    // the two faces
    quad(out, W(inner[i], u0, z), W(outer[i], u0, z), W(outer[i + 1], u0, z2), W(inner[i + 1], u0, z2));
    quad(out, W(inner[i], u1, z), W(inner[i + 1], u1, z2), W(outer[i + 1], u1, z2), W(outer[i], u1, z));
    // inner and outer edges
    quad(out, W(inner[i], u0, z), W(inner[i + 1], u0, z2), W(inner[i + 1], u1, z2), W(inner[i], u1, z));
    quad(out, W(outer[i], u0, z), W(outer[i], u1, z), W(outer[i + 1], u1, z2), W(outer[i + 1], u0, z2));
  }
  quad(out, W(inner[0], u0, zs[0]), W(inner[0], u1, zs[0]), W(outer[0], u1, zs[0]), W(outer[0], u0, zs[0]));
  const k = n - 1;
  quad(out, W(inner[k], u0, zs[k]), W(outer[k], u0, zs[k]), W(outer[k], u1, zs[k]), W(inner[k], u1, zs[k]));
}

function box(out, W, v0, v1, u0, u1, z0, z1) {
  plate(out, W, [z0, z1], [v0, v0], [v1, v1], u0, u1);
}

function disc(out, W, vc, uc, r, h, seg = 28) {
  const ring = Array.from({ length: seg }, (_, i) => {
    const a = (i / seg) * Math.PI * 2;
    return [vc + Math.cos(a) * r, uc + Math.sin(a) * r];
  });
  const c0 = W(vc, uc, 0), c1 = W(vc, uc, h);
  for (let i = 0; i < seg; i++) {
    const [va, ua] = ring[i], [vb, ub] = ring[(i + 1) % seg];
    const a0 = W(va, ua, 0), b0 = W(vb, ub, 0), a1 = W(va, ua, h), b1 = W(vb, ub, h);
    tri(out, c0, b0, a0);
    tri(out, c1, a1, b1);
    quad(out, a0, b0, b1, a1);
  }
}
