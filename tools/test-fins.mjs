// Checks the stabilizer fin geometry on simple parts. No dependencies:
//   node tools/test-fins.mjs

import assert from "node:assert/strict";
import { analyze, suggestFins, buildFin, finAt, seat, rotate90, parseStl, writeStl, DEFAULTS, FIN } from "../assets/fins-geometry.js";

/** Axis-aligned box as triangles. */
function boxMesh(x0, y0, z0, x1, y1, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return new Float32Array(f.flatMap((t) => t.flatMap((i) => v[i])));
}

/** Upright cylinder, radius r, height h, on the bed. */
function cylinderMesh(r, h, seg = 48) {
  const out = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, b = ((i + 1) / seg) * Math.PI * 2;
    const p = [Math.cos(a) * r, Math.sin(a) * r], q = [Math.cos(b) * r, Math.sin(b) * r];
    out.push(0, 0, 0, q[0], q[1], 0, p[0], p[1], 0);
    out.push(0, 0, h, p[0], p[1], h, q[0], q[1], h);
    out.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], h);
    out.push(p[0], p[1], 0, q[0], q[1], h, p[0], p[1], h);
  }
  return new Float32Array(out);
}

let failures = 0;
function test(name, fn) {
  try { fn(); console.log("ok  ", name); }
  catch (err) { failures++; console.log("FAIL", name, "\n     ", err.message); }
}

/** No fin vertex inside the box, except tine ends, which bite FIN.tineBite into it. */
function assertClearOfBox(tris, [x0, y0, x1, y1, z1]) {
  const slack = FIN.tineBite + 1e-3;
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    const depth = Math.min(x - x0, x1 - x, y - y0, y1 - y, z1 - z);
    assert.ok(depth <= slack, `fin vertex (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) is ${depth.toFixed(2)} mm inside the part`);
  }
}

test("a thin tall wall is high risk and thin along y", () => {
  const a = analyze(boxMesh(-30, -2, 0, 30, 2, 80));
  assert.equal(a.risk, "high");
  assert.ok(Math.abs(a.minor[1]) > 0.99, `minor axis ${a.minor}`);
  assert.ok(Math.abs(a.baseWidth - 4) < 1e-3);
  assert.ok(Math.abs(a.height - 80) < 1e-3);
});

test("a cube is low risk", () => {
  assert.equal(analyze(boxMesh(-10, -10, 0, 10, 10, 20)).risk, "low");
});

test("suggested fins come in pairs on both thin sides", () => {
  const fins = suggestFins(analyze(boxMesh(-30, -2, 0, 30, 2, 80)));
  assert.equal(fins.length, 4);
  const sides = fins.map((f) => Math.round(Math.sin(f.angle)));
  assert.deepEqual(sides.sort(), [-1, -1, 1, 1]);
});

test("a needle gets fins on all four sides", () => {
  const fins = suggestFins(analyze(boxMesh(-3, -2, 0, 3, 2, 60)));
  assert.equal(fins.length, 4);
  const dirs = new Set(fins.map((f) => `${Math.round(Math.cos(f.angle))},${Math.round(Math.sin(f.angle))}`));
  assert.equal(dirs.size, 4);
});

test("fins clear the part, grip it with tines and stand on the bed", () => {
  const mesh = boxMesh(-30, -2, 0, 30, 2, 80);
  const a = analyze(mesh);
  for (const fin of suggestFins(a)) {
    const r = buildFin(mesh, a.height, fin);
    assert.ok(r.ok, r.reason);
    assert.ok(Math.abs(r.height - (80 * DEFAULTS.heightPct) / 100) < 0.01, `height ${r.height}`);
    assert.ok(r.tines >= 8, `${r.tines} tines`);
    assertClearOfBox(r.tris, [-30, -2, 30, 2, 80]);
    let zmin = Infinity;
    for (let i = 2; i < r.tris.length; i += 3) zmin = Math.min(zmin, r.tris[i]);
    assert.equal(zmin, 0);
  }
});

test("every fin solid is closed and wound outwards", () => {
  // Each directed edge must be matched by the same edge running the other way.
  const mesh = cylinderMesh(4, 70);
  const r = buildFin(mesh, 70, finAt(0, [0, 0]));
  assert.ok(r.ok, r.reason);
  const key = (i) => `${r.tris[i].toFixed(4)},${r.tris[i + 1].toFixed(4)},${r.tris[i + 2].toFixed(4)}`;
  const edges = new Map();
  for (let i = 0; i < r.tris.length; i += 9) {
    const v = [key(i), key(i + 3), key(i + 6)];
    for (let k = 0; k < 3; k++) {
      const e = `${v[k]}|${v[(k + 1) % 3]}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  }
  for (const [e, n] of edges) {
    const [a, b] = e.split("|");
    assert.equal(edges.get(`${b}|${a}`), n, `open or flipped edge ${e}`);
  }
  // Outward: the signed volume of every solid adds up positive.
  let vol = 0;
  for (let i = 0; i < r.tris.length; i += 9) {
    const t = r.tris;
    vol += (t[i] * (t[i + 4] * t[i + 8] - t[i + 5] * t[i + 7]) - t[i + 1] * (t[i + 3] * t[i + 8] - t[i + 5] * t[i + 6]) + t[i + 2] * (t[i + 3] * t[i + 7] - t[i + 4] * t[i + 6])) / 6;
  }
  assert.ok(vol > 0, `volume ${vol}`);
});

test("tines are exactly one layer tall and reach into the part", () => {
  const mesh = boxMesh(-30, -2, 0, 30, 2, 80);
  const r = buildFin(mesh, 80, finAt(Math.PI / 2, [0, 0]), { layerH: 0.16 });
  assert.ok(r.ok);
  // Tine boxes are the only solids with an end inside the part (y < 2).
  const ends = new Set();
  for (let i = 0; i < r.tris.length; i += 3) if (r.tris[i + 1] < 2) ends.add(r.tris[i + 2].toFixed(3));
  const zs = [...ends].map(Number).sort((p, q) => p - q);
  assert.equal(zs.length, r.tines * 2);
  for (let i = 0; i < zs.length; i += 2) assert.ok(Math.abs(zs[i + 1] - zs[i] - 0.16) < 1e-4, `tine ${zs[i]}..${zs[i + 1]}`);
});

test("a fin off the side of the part says why", () => {
  const r = buildFin(boxMesh(-30, -2, 0, 30, 2, 80), 80, finAt(Math.PI / 2, [50, 0]));
  assert.equal(r.ok, false);
  assert.match(r.reason, /No part surface/);
});

test("a fin follows a round part", () => {
  const mesh = cylinderMesh(4, 70);
  const a = analyze(mesh);
  assert.equal(a.risk, "high");
  const fins = suggestFins(a);
  assert.ok(fins.length >= 2);
  for (const fin of fins) {
    const r = buildFin(mesh, a.height, fin);
    assert.ok(r.ok, r.reason);
    assert.ok(r.tines >= 5, `${r.tines} tines`);
    for (let i = 0; i < r.tris.length; i += 3) {
      const rad = Math.hypot(r.tris[i], r.tris[i + 1]);
      assert.ok(rad >= 4 - FIN.tineBite - 0.05, `vertex at radius ${rad.toFixed(2)}`);
    }
  }
});

test("a part that narrows keeps the fin edge at or under 45 degrees", () => {
  // A wide base with a thin post on top: the fin's inner edge must step in gradually.
  const mesh = new Float32Array([...boxMesh(-20, -8, 0, 20, 8, 5), ...boxMesh(-20, -2, 5, 20, 2, 60)]);
  const r = buildFin(mesh, 60, finAt(Math.PI / 2, [0, 0]));
  assert.ok(r.ok, r.reason);
  assert.ok(r.tines > 3);
});

test("rotate, seat, and STL round trip", () => {
  const mesh = seat(rotate90(boxMesh(0, 0, 0, 10, 20, 30), "x"));
  const a = analyze(mesh);
  assert.ok(Math.abs(a.height - 20) < 1e-4);
  const back = parseStl(writeStl([mesh]));
  assert.deepEqual(Array.from(back), Array.from(mesh));
  const ascii = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";
  assert.equal(parseStl(new TextEncoder().encode(ascii).buffer).length, 9);
});

test("STL edge cases: capitals, trailing bytes, long non-Latin names", () => {
  const upper = "SOLID T\nFACET NORMAL 0 0 1\nOUTER LOOP\nVERTEX 0 0 0\nVERTEX 1 0 0\nVERTEX 0 1 0\nENDLOOP\nENDFACET\nENDSOLID T\n";
  assert.equal(parseStl(new TextEncoder().encode(upper).buffer).length, 9);
  const mesh = boxMesh(0, 0, 0, 1, 2, 3);
  const exact = new Uint8Array(writeStl([mesh]));
  const padded = new Uint8Array(exact.length + 7);
  padded.set(exact);
  assert.deepEqual(Array.from(parseStl(padded.buffer)), Array.from(mesh));
  const header = new Uint8Array(writeStl([mesh], "部品".repeat(60)), 0, 80);
  assert.equal(new TextDecoder().decode(header).slice(0, 26), "部品".repeat(13));
  assert.throws(() => parseStl(new ArrayBuffer(10)), /not a valid STL/);
});

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
