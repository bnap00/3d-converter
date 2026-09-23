/* Runs OpenCascade (via occt-import-js) off the main thread and writes binary STL. */
const OCCT_DIR = "/vendor/occt-import-js@0.0.23/";
importScripts(OCCT_DIR + "occt-import-js.js");

const QUALITY = {
  draft: { linear: 0.2, angular: 0.6 },
  standard: { linear: 0.05, angular: 0.35 },
  fine: { linear: 0.01, angular: 0.2 },
};

let occt = null;
function loadOcct() {
  if (!occt) {
    occt = occtimportjs({ locateFile: (path) => OCCT_DIR + path });
    occt.catch(() => { occt = null; });
  }
  return occt;
}

function triangleCount(meshes) {
  let n = 0;
  for (const m of meshes) n += Math.floor(m.indices.length / 3);
  return n;
}

/* Binary STL: 80-byte header, uint32 count, then 50 bytes per facet. Normals come from the winding order. */
function writeBinaryStl(meshes, header) {
  const count = triangleCount(meshes);
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  new Uint8Array(buffer, 0, 80).set(new TextEncoder().encode(String(header).slice(0, 80)));
  view.setUint32(80, count, true);

  let o = 84;
  for (const { positions: p, indices: idx } of meshes) {
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2];
      const bx = p[b], by = p[b + 1], bz = p[b + 2];
      const cx = p[c], cy = p[c + 1], cz = p[c + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;

      view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
      view.setFloat32(o + 12, ax, true); view.setFloat32(o + 16, ay, true); view.setFloat32(o + 20, az, true);
      view.setFloat32(o + 24, bx, true); view.setFloat32(o + 28, by, true); view.setFloat32(o + 32, bz, true);
      view.setFloat32(o + 36, cx, true); view.setFloat32(o + 40, cy, true); view.setFloat32(o + 44, cz, true);
      view.setUint16(o + 48, 0, true);
      o += 50;
    }
  }
  return buffer;
}

function safeName(name, fallback) {
  const cleaned = String(name || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").trim();
  return cleaned || fallback;
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "warmup") {
    loadOcct().then(() => self.postMessage({ type: "ready" }), () => {});
    return;
  }

  const { id, name, format, buffer, quality, splitBodies } = msg;
  try {
    const lib = await loadOcct();
    const q = QUALITY[quality] || QUALITY.standard;
    const params = {
      linearUnit: "millimeter",
      linearDeflectionType: "absolute_value",
      linearDeflection: q.linear,
      angularDeflection: q.angular,
    };
    const bytes = new Uint8Array(buffer);
    const result = format === "iges" ? lib.ReadIgesFile(bytes, params) : lib.ReadStepFile(bytes, params);
    if (!result || !result.success) {
      throw new Error(`This file could not be read. It may be damaged or not a valid ${format.toUpperCase()} file.`);
    }

    const meshes = result.meshes
      .filter((m) => m.index && m.index.array.length >= 3)
      .map((m, i) => ({ name: m.name || `body-${i + 1}`, positions: m.attributes.position.array, indices: m.index.array }));
    if (meshes.length === 0) {
      throw new Error("No solid geometry found. The file may only contain curves or an empty assembly.");
    }

    const base = safeName(name.replace(/\.(step|stp|iges|igs)$/i, ""), "model");
    const outputs = [];
    if (splitBodies && meshes.length > 1) {
      const used = new Map();
      meshes.forEach((m, i) => {
        let n = safeName(m.name, `body-${i + 1}`);
        const seen = used.get(n) || 0;
        used.set(n, seen + 1);
        if (seen) n = `${n}-${seen + 1}`;
        outputs.push({ name: `${base}/${n}.stl`, data: writeBinaryStl([m], n), triangles: triangleCount([m]) });
      });
    } else {
      outputs.push({ name: `${base}.stl`, data: writeBinaryStl(meshes, base), triangles: triangleCount(meshes) });
    }

    self.postMessage({ id, ok: true, outputs, bodies: meshes.length }, outputs.map((o) => o.data));
  } catch (err) {
    // A WebAssembly abort (usually out of memory) leaves the module unusable, so reload it next time.
    const text = String(err && err.message ? err.message : err);
    const isAbort = err instanceof WebAssembly.RuntimeError || /abort|memory|OOM/i.test(text);
    if (isAbort) occt = null;
    self.postMessage({
      id,
      ok: false,
      error: isAbort ? "Ran out of memory on this file. Try Draft quality, or convert it on its own." : text,
    });
  }
};
