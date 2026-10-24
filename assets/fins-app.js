/* 3D Converter: stabilizer fins for tall, thin parts, entirely client-side. */
import { DEFAULTS, parseStl, writeStl, rotate90, seat, analyze, suggestFins, finAt, buildFin } from "/assets/fins-geometry.js";

const FORMATS = { stl: "stl", step: "step", stp: "step", iges: "iges", igs: "iges" };
const RISK_TEXT = {
  high: "Likely to tip over. Fins on both sides are recommended.",
  medium: "Could tip over, especially on a bed slinger or at speed. Fins help.",
  low: "Stable on its own. Fins are optional, but you can still add them.",
};

const $ = (sel) => document.querySelector(sel);
const els = {
  card: $("#fins-tool-card"),
  stage: $("#fins-stage"),
  drop: $("#fins-drop"),
  input: $("#fins-input"),
  loading: $("#fins-loading"),
  loadingText: $("#fins-loading-text"),
  toolbar: $("#fins-toolbar"),
  help: $("#fins-help"),
  panel: $("#fins-panel"),
  name: $("#part-name"),
  height: $("#st-height"),
  base: $("#st-base"),
  ratio: $("#st-ratio"),
  risk: $("#st-risk"),
  count: $("#fin-count"),
  list: $("#fin-list"),
  empty: $("#fins-empty"),
  suggest: $("#suggest-fins"),
  add: $("#add-fin"),
  edit: $("#fin-edit"),
  editTitle: $("#fin-edit-title"),
  del: $("#fin-delete"),
  pos: $("#fin-pos"),
  posOut: $("#fin-pos-out"),
  h: $("#fin-h"),
  hOut: $("#fin-h-out"),
  notice: $("#fins-notice"),
  download: $("#download-fins"),
};

/* ---------- Analytics ---------- */

// Same rules as the converter: formats, counts, size buckets and settings. Never file names or contents.
function track(name, props) {
  try { window.rybbit?.event(name, props); } catch {}
}
function sizeBucket(bytes) {
  const mb = bytes / 1024 / 1024;
  return mb < 1 ? "<1 MB" : mb < 10 ? "1-10 MB" : mb < 50 ? "10-50 MB" : "50+ MB";
}

/* ---------- State ---------- */

const settings = { ...DEFAULTS };
const state = {
  file: null,      // { name, ext, size }
  mesh: null,      // Float32Array, seated on the bed
  a: null,         // analyze(mesh)
  fins: [],        // { id, angle, u, height, key?, result? }
  selected: null,  // index into fins
  addMode: false,
};
let seq = 0;
let view = null;
let viewModule;

const mm = (v) => `${v.toFixed(v < 10 ? 1 : 0)} mm`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Where a fin faces, in bed terms: +Y is the back of the bed. */
function sideName(angle) {
  const names = ["Right", "Back right", "Back", "Back left", "Left", "Front left", "Front", "Front right"];
  const i = Math.round((((angle / (Math.PI * 2)) % 1) + 1) * 8) % 8;
  return names[i];
}

/* ---------- Loading a part ---------- */

let worker = null;
function convertCad(file, format, buffer) {
  worker ??= new Worker("/assets/converter-worker.js");
  const w = worker;
  return new Promise((resolve, reject) => {
    const id = `fins${++seq}`;
    const done = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    const onMessage = (e) => {
      if (!e.data || e.data.id !== id) return;
      done();
      if (e.data.ok) resolve(e.data.outputs[0].data);
      else reject(new Error(e.data.error));
    };
    const onError = (e) => {
      e.preventDefault();
      done();
      w.terminate();
      if (worker === w) worker = null;
      reject(new Error("The converter crashed on this file. Try exporting STL from your CAD program."));
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    w.postMessage({ id, name: file.name, format, buffer, quality: "standard", splitBodies: false }, [buffer]);
  });
}

let loadSeq = 0;
async function loadFile(file, source) {
  if (!file) return;
  const load = ++loadSeq;
  const ext = file.name.split(".").pop().toLowerCase();
  const format = FORMATS[ext];
  if (!format) {
    showNotice(`${file.name} is not an STL, STEP or IGES file.`, true);
    return;
  }
  const started = performance.now();
  setStage("loading", format === "stl" ? "Reading the part" : "Loading the converter engine (7.6 MB, first time only) and converting");
  try {
    let buffer;
    try { buffer = await file.arrayBuffer(); } catch { throw new Error("Could not read this file from disk."); }
    if (format !== "stl") buffer = await convertCad(file, format, buffer);
    const mesh = seat(parseStl(buffer));
    if (!mesh.length) throw new Error("This file has no triangles.");
    viewModule ??= import("/assets/fins-view.js");
    const { mountView } = await viewModule;
    if (load !== loadSeq) return; // another file was dropped meanwhile
    view ??= mountView(els.stage, { onPick, onSelect: select });
    state.file = { name: file.name, ext, size: file.size };
    setMesh(mesh, true);
    setStage("ready");
    track("fins_file_loaded", {
      source,
      format: ext,
      size: sizeBucket(file.size),
      seconds: Math.round((performance.now() - started) / 100) / 10,
      triangles: mesh.length / 9,
      risk: state.a.risk,
    });
  } catch (err) {
    if (load !== loadSeq) return;
    setStage(state.mesh ? "ready" : "empty");
    const text = String(err && err.message ? err.message : err);
    showNotice(/WebGL/i.test(text) ? "The 3D view could not start. Your browser may not support WebGL." : text, true);
    track("fins_file_failed", { format: ext });
  }
}

function setStage(stage, text) {
  els.card.dataset.state = stage;
  els.drop.hidden = stage !== "empty";
  els.loading.hidden = stage !== "loading";
  if (text) els.loadingText.textContent = text;
  els.toolbar.hidden = els.help.hidden = els.panel.hidden = stage !== "ready";
}

function setMesh(mesh, frame) {
  state.mesh = mesh;
  spanCache.clear();
  state.a = analyze(mesh);
  state.selected = null;
  view.setPart(mesh, { frame });
  view.select(null);
  state.fins = state.a.risk === "low" ? [] : suggestFins(state.a).map((f) => ({ ...f, id: ++seq }));
  showNotice("");
  render();
}

/* ---------- Fins ---------- */

const keyOf = (fin) => JSON.stringify([fin.angle, fin.u, fin.height, settings]);

let rebuildQueued = false;
function render() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    for (const fin of state.fins) {
      const key = keyOf(fin);
      if (fin.key !== key) {
        fin.result = buildFin(state.mesh, state.a.height, fin, settings);
        fin.key = key;
      }
    }
    view.setFins(state.fins.map((f) => f.result.tris));
    view.select(state.selected);
    renderPanel();
  });
}

function renderPanel() {
  const { a, fins } = state;
  els.name.textContent = state.file.name;
  els.name.title = state.file.name;
  els.height.textContent = mm(a.height);
  els.base.textContent = mm(a.baseWidth);
  els.ratio.textContent = `${a.ratio.toFixed(1)} to 1`;
  els.risk.dataset.risk = a.risk;
  els.risk.textContent = RISK_TEXT[a.risk];

  const built = fins.filter((f) => f.result.ok);
  els.count.textContent = fins.length ? `(${fins.length})` : "";
  els.empty.hidden = fins.length > 0;
  els.list.replaceChildren(
    ...fins.map((fin, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fin-item";
      btn.dataset.index = i;
      btn.setAttribute("aria-pressed", String(i === state.selected));
      const title = document.createElement("span");
      title.className = "fin-item-title";
      title.textContent = `Fin ${i + 1}, ${sideName(fin.angle).toLowerCase()}`;
      const meta = document.createElement("span");
      meta.className = "fin-item-meta";
      const r = fin.result;
      if (!r.ok) {
        meta.textContent = r.reason;
        btn.dataset.status = "error";
      } else {
        meta.textContent = `${mm(r.height)} tall, ${plural(r.tines, "tine")}`;
        if (r.tines < 2) {
          meta.textContent += ". Too few tines to hold the part here.";
          btn.dataset.status = "warn";
        }
      }
      btn.append(title, meta);
      li.append(btn);
      return li;
    })
  );

  const fin = fins[state.selected];
  els.edit.hidden = !fin;
  if (fin) {
    els.editTitle.textContent = `Fin ${state.selected + 1}, ${sideName(fin.angle).toLowerCase()}`;
    const [lo, hi] = spanAcross(fin.angle);
    els.pos.min = String(Math.floor(lo));
    els.pos.max = String(Math.ceil(hi));
    els.pos.value = String(fin.u);
    const mid = (lo + hi) / 2;
    els.posOut.textContent = `${fin.u - mid >= 0 ? "+" : ""}${(fin.u - mid).toFixed(1)} mm`;
    els.h.min = "5";
    els.h.max = String(Math.max(5, Math.floor(a.height)));
    const h = fin.height ?? (a.height * settings.heightPct) / 100;
    els.h.value = String(h);
    els.hOut.textContent = fin.height == null ? `${mm(h)}, auto` : mm(h);
  }

  els.download.disabled = !state.mesh;
  els.download.lastChild.textContent = built.length ? "Download STL with fins" : "Download STL";
}

/** The part's extent across a fin facing `angle`, for the position slider. Cached per angle until the part changes. */
const spanCache = new Map();
function spanAcross(angle) {
  const key = angle;
  if (!spanCache.has(key)) {
    const tx = -Math.sin(angle), ty = Math.cos(angle);
    let lo = Infinity, hi = -Infinity;
    const m = state.mesh;
    for (let i = 0; i < m.length; i += 3) {
      const u = m[i] * tx + m[i + 1] * ty;
      if (u < lo) lo = u;
      if (u > hi) hi = u;
    }
    spanCache.set(key, [lo, hi]);
  }
  return spanCache.get(key);
}

function select(index) {
  state.selected = index;
  if (view) view.select(index);
  renderPanel();
}

function setAddMode(on) {
  state.addMode = on;
  els.add.setAttribute("aria-pressed", String(on));
  els.help.textContent = on
    ? "Click the side of the part where the new fin should go."
    : "Drag to orbit, scroll to zoom, right-drag to pan. Click a fin to edit it.";
  view?.setCursor(on ? "crosshair" : "");
}

/** A click on the part: in add mode, put a fin there, facing out from that side. */
function onPick({ point, normal }) {
  if (!state.addMode) return select(null);
  const a = state.a;
  let nx = normal[0], ny = normal[1];
  if (Math.hypot(nx, ny) < 0.35) {
    // A top or bottom face: face out from the middle of the part instead.
    nx = point[0]; ny = point[1];
    if (Math.hypot(nx, ny) < 1e-3) return showNotice("Click a side of the part, not the top.", true);
  }
  let angle = Math.atan2(ny, nx);
  // Snap to the part's own sides when the click is close to one.
  for (const axis of [a.major, a.minor]) {
    for (const s of [1, -1]) {
      const snap = Math.atan2(axis[1] * s, axis[0] * s);
      const diff = Math.atan2(Math.sin(angle - snap), Math.cos(angle - snap));
      if (Math.abs(diff) < (15 * Math.PI) / 180) angle = snap;
    }
  }
  state.fins.push({ ...finAt(angle, point), id: ++seq });
  setAddMode(false);
  showNotice("");
  track("fin_added", { fins: state.fins.length });
  state.selected = state.fins.length - 1;
  render();
}

function deleteSelected() {
  if (state.selected == null) return;
  state.fins.splice(state.selected, 1);
  state.selected = null;
  track("fin_removed", { fins: state.fins.length });
  render();
}

function showNotice(text, isError) {
  els.notice.textContent = text;
  els.notice.hidden = !text;
  if (!state.mesh && text) {
    // Before a part is loaded the panel is hidden, so show the message under the drop zone.
    els.drop.querySelector(".dz-help").textContent = text;
  } else if (!state.mesh) {
    els.drop.querySelector(".dz-help").textContent = ".stl, .step, .stp, .iges or .igs. One part at a time.";
  }
  els.notice.dataset.error = String(Boolean(isError));
}

/* ---------- Download ---------- */

function download() {
  const parts = [state.mesh, ...state.fins.filter((f) => f.result.ok).map((f) => f.result.tris)];
  const base = state.file.name.replace(/\.(stl|step|stp|iges|igs)$/i, "") || "part";
  const name = parts.length > 1 ? `${base}-fins.stl` : `${base}.stl`;
  const blob = new Blob([writeStl(parts, `${base} with stabilizer fins`)], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  track("fins_download", {
    fins: parts.length - 1,
    tines: state.fins.reduce((s, f) => s + (f.result.ok ? f.result.tines : 0), 0),
    risk: state.a.risk,
    layer_height: settings.layerH,
  });
}

/* ---------- Events ---------- */

els.input.addEventListener("change", () => {
  loadFile(els.input.files[0], "picker");
  els.input.value = "";
});

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  els.card.classList.add("is-dragging");
});
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.card.classList.remove("is-dragging");
});
window.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.card.classList.remove("is-dragging");
  loadFile(e.dataTransfer.files[0], "drop");
});

els.toolbar.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-turn]");
  if (!btn || !state.mesh) return;
  track("fins_turned", { axis: btn.dataset.turn });
  setMesh(seat(rotate90(state.mesh, btn.dataset.turn)), true);
});

els.add.addEventListener("click", () => setAddMode(!state.addMode));

els.suggest.addEventListener("click", () => {
  state.fins = suggestFins(state.a).map((f) => ({ ...f, id: ++seq }));
  state.selected = null;
  track("fins_suggested", { fins: state.fins.length, risk: state.a.risk });
  render();
});

els.list.addEventListener("click", (e) => {
  const btn = e.target.closest(".fin-item");
  if (btn) select(Number(btn.dataset.index) === state.selected ? null : Number(btn.dataset.index));
});

els.del.addEventListener("click", deleteSelected);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && state.addMode) return setAddMode(false);
  if ((e.key === "Delete" || e.key === "Backspace") && state.selected != null && !e.target.closest("input, textarea")) {
    e.preventDefault();
    deleteSelected();
  }
});

els.pos.addEventListener("input", () => {
  const fin = state.fins[state.selected];
  if (!fin) return;
  fin.u = Number(els.pos.value);
  render();
});
els.h.addEventListener("input", () => {
  const fin = state.fins[state.selected];
  if (!fin) return;
  fin.height = Number(els.h.value);
  render();
});

const SETTING_FORMAT = {
  heightPct: (v) => `${v}%`,
  depthPct: (v) => `${v}%`,
  thickness: (v) => `${v.toFixed(1)} mm`,
  gap: (v) => `${v.toFixed(2)} mm`,
  layerH: (v) => `${v.toFixed(2)} mm`,
  tineSpacing: (v) => `${v} mm`,
};
document.querySelectorAll("[data-setting]").forEach((input) => {
  const key = input.dataset.setting;
  const out = document.getElementById(`${input.id}-out`);
  const show = () => { out.textContent = SETTING_FORMAT[key](Number(input.value)); };
  input.value = String(settings[key]);
  show();
  input.addEventListener("input", () => {
    settings[key] = Number(input.value);
    show();
    if (state.mesh) render();
  });
  input.addEventListener("change", () => track("fins_setting_changed", { setting: key, value: settings[key] }));
});

els.download.addEventListener("click", download);

document.querySelectorAll(".faq details").forEach((details) =>
  details.addEventListener("toggle", () => {
    if (details.open) track("faq_opened", { question: details.querySelector("summary").textContent.trim() });
  })
);
