/* 3D Converter: STEP/IGES to STL, entirely client-side. */

const QUALITY_HINTS = {
  draft: "0.2 mm tolerance, smallest files",
  standard: "0.05 mm tolerance, good for most prints",
  fine: "0.01 mm tolerance, smooth curves, large files",
};
const FORMATS = { step: "step", stp: "step", iges: "iges", igs: "iges" };

const $ = (sel) => document.querySelector(sel);
const els = {
  converter: $("#converter"),
  dropzone: $("#dropzone"),
  input: $("#file-input"),
  notice: $("#notice"),
  qualityHint: $("#quality-hint"),
  split: $("#split-bodies"),
  reapply: $("#reapply"),
  reapplyBtn: $("#reapply-btn"),
  engine: $("#engine"),
  queue: $("#queue"),
  bar: $("#queue-bar"),
  summary: $("#queue-summary"),
  clearBtn: $("#clear-btn"),
  downloadAll: $("#download-all"),
  readyToPrint: $("#ready-to-print"),
  rowTemplate: $("#row-template"),
  preview: $("#preview"),
  previewTitle: $("#preview-title"),
  previewStage: $("#preview-stage"),
  previewClose: $("#preview-close"),
};

/* ---------- Worker pool ---------- */

class ConverterPool {
  constructor(onReady) {
    // Each worker holds its own OpenCascade instance (a few hundred MB for big files), so keep it small.
    this.size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
    this.idle = [];
    this.queue = [];
    this.started = false;
    this.onReady = onReady;
  }

  spawn() {
    const w = new Worker("/assets/converter-worker.js");
    w.addEventListener("message", (e) => { if (e.data && e.data.type === "ready") this.onReady(); });
    w.postMessage({ type: "warmup" });
    return w;
  }

  warmup() {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.size; i++) this.idle.push(this.spawn());
  }

  /** job: { id, prepare: () => Promise<request>, onStart: () => void } */
  convert(job) {
    this.warmup();
    return new Promise((resolve) => {
      this.queue.push({ ...job, resolve });
      this.pump();
    });
  }

  pump() {
    while (this.idle.length && this.queue.length) this.run(this.idle.pop(), this.queue.shift());
  }

  async run(worker, job) {
    const finish = (res, crashed) => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      if (crashed) {
        worker.terminate();
        worker = this.spawn();
      }
      this.idle.push(worker);
      job.resolve(res);
      this.pump();
    };
    const onMessage = (e) => { if (e.data && e.data.id === job.id) finish(e.data, false); };
    const onError = (e) => {
      e.preventDefault();
      finish({ id: job.id, ok: false, error: "The converter crashed on this file. Try Draft quality, or convert it on its own." }, true);
    };

    let req;
    try {
      job.onStart();
      // Read the file only when a worker is free, so a big batch is not all held in memory at once.
      req = await job.prepare();
    } catch (err) {
      this.idle.push(worker);
      job.resolve({ id: job.id, ok: false, error: String(err && err.message ? err.message : err) });
      this.pump();
      return;
    }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ ...req, id: job.id }, [req.buffer]);
  }
}

let engineReady = false;
const pool = new ConverterPool(() => {
  engineReady = true;
  els.engine.hidden = true;
});

/* ---------- State ---------- */

const settings = { quality: "standard", splitBodies: false };
/** @type {Map<string, {id:string,file:File,format:string,status:string,outputs?:any[],bodies?:number,error?:string,settingsKey?:string,el:HTMLElement,run:number}>} */
const items = new Map();
let seq = 0;

const settingsKey = () => `${settings.quality}|${settings.splitBodies}`;

/* ---------- Formatting ---------- */

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/* ---------- Adding files ---------- */

function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const skipped = [];
  for (const file of files) {
    const ext = file.name.split(".").pop().toLowerCase();
    const format = FORMATS[ext];
    if (!format) { skipped.push(file.name); continue; }

    const id = `f${++seq}`;
    const el = els.rowTemplate.content.firstElementChild.cloneNode(true);
    el.dataset.id = id;
    el.querySelector(".row-name").textContent = file.name;
    el.querySelector(".row-name").title = file.name;
    els.queue.append(el);

    const item = { id, file, format, status: "queued", el, run: 0 };
    items.set(id, item);
    renderRow(item);
    convert(item);
  }

  if (skipped.length) {
    const names = skipped.slice(0, 3).join(", ") + (skipped.length > 3 ? ` and ${skipped.length - 3} more` : "");
    showNotice(`Skipped ${plural(skipped.length, "file")} that ${skipped.length === 1 ? "is" : "are"} not STEP or IGES: ${names}.`);
  } else {
    showNotice("");
  }
  renderSummary();
}

function showNotice(text) {
  els.notice.textContent = text;
  els.notice.hidden = !text;
}

async function convert(item) {
  const run = ++item.run;
  item.status = "queued";
  item.outputs = undefined;
  item.error = undefined;
  item.settingsKey = settingsKey();
  renderRow(item);
  renderSummary();

  if (!engineReady) els.engine.hidden = false;

  const [quality, split] = item.settingsKey.split("|");
  const res = await pool.convert({
    id: `${item.id}:${run}`,
    onStart: () => {
      if (!items.has(item.id) || item.run !== run) return;
      item.status = "converting";
      renderRow(item);
    },
    prepare: async () => {
      if (!items.has(item.id) || item.run !== run) throw new Error("Removed");
      let buffer;
      try {
        buffer = await item.file.arrayBuffer();
      } catch {
        throw new Error("Could not read this file from disk.");
      }
      return { name: item.file.name, format: item.format, buffer, quality, splitBodies: split === "true" };
    },
  });

  // Ignore results for removed items or superseded runs.
  if (!items.has(item.id) || item.run !== run) return;

  if (res.ok) Object.assign(item, { status: "done", outputs: res.outputs, bodies: res.bodies });
  else Object.assign(item, { status: "error", error: res.error });
  renderRow(item);
  renderSummary();
}

/* ---------- Rendering ---------- */

function renderRow(item) {
  const { el } = item;
  el.dataset.status = item.status;
  const meta = el.querySelector(".row-meta");
  const icon = el.querySelector(".row-icon use");
  const size = formatBytes(item.file.size);

  if (item.status === "done") {
    const bytes = item.outputs.reduce((s, o) => s + o.data.byteLength, 0);
    const tris = item.outputs.reduce((s, o) => s + o.triangles, 0);
    const parts = [`${size} to ${formatBytes(bytes)}`, plural(tris, "triangle")];
    if (item.outputs.length > 1) parts.push(`${item.outputs.length} STL files`);
    meta.textContent = parts.join(", ");
    icon.setAttribute("href", "/assets/icons-v1.svg#i-check-circle");
  } else if (item.status === "error") {
    meta.textContent = item.error;
    icon.setAttribute("href", "/assets/icons-v1.svg#i-warning-circle");
  } else {
    meta.textContent = item.status === "converting" ? `${size}, converting` : `${size}, waiting`;
    icon.setAttribute("href", "/assets/icons-v1.svg#i-cube");
  }

  const done = item.status === "done";
  el.querySelector('[data-action="preview"]').disabled = !done;
  const dl = el.querySelector('[data-action="download"]');
  dl.disabled = !done;
  const dlLabel = done && item.outputs.length > 1 ? "Download ZIP" : "Download STL";
  dl.title = dlLabel;
  dl.setAttribute("aria-label", `${dlLabel}: ${item.file.name}`);
}

function renderSummary() {
  const all = [...items.values()];
  const done = all.filter((i) => i.status === "done").length;
  const failed = all.filter((i) => i.status === "error").length;
  const pending = all.length - done - failed;

  els.converter.dataset.hasItems = String(all.length > 0);
  els.bar.hidden = all.length === 0;
  els.downloadAll.disabled = done === 0;
  els.readyToPrint.hidden = done === 0;

  let text = `<strong>${done} of ${all.length}</strong> converted`;
  if (failed) text += `, ${failed} failed`;
  els.summary.innerHTML = text;

  if (!pending) els.engine.hidden = true;

  const stale = all.some((i) => (i.status === "done" || i.status === "error") && i.settingsKey !== settingsKey());
  els.reapply.hidden = !stale;
}

/* ---------- Downloads ---------- */

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

let fflatePromise;
const loadFflate = () => (fflatePromise ??= import("/vendor/fflate@0.8.3/fflate.js"));

async function saveZip(outputs, filename) {
  const { zip } = await loadFflate();
  const entries = {};
  for (const o of outputs) {
    let name = o.name;
    for (let n = 2; entries[name]; n++) name = o.name.replace(/\.stl$/i, `-${n}.stl`);
    entries[name] = new Uint8Array(o.data);
  }
  const data = await new Promise((resolve, reject) =>
    zip(entries, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out)))
  );
  saveBlob(new Blob([data], { type: "application/zip" }), filename);
}

function downloadItem(item) {
  if (item.outputs.length === 1) {
    const o = item.outputs[0];
    saveBlob(new Blob([o.data], { type: "model/stl" }), o.name.split("/").pop());
  } else {
    saveZip(item.outputs, item.outputs[0].name.split("/")[0] + ".zip");
  }
}

async function downloadAll() {
  const outputs = [...items.values()].filter((i) => i.status === "done").flatMap((i) => i.outputs);
  if (!outputs.length) return;
  if (outputs.length === 1) {
    saveBlob(new Blob([outputs[0].data], { type: "model/stl" }), outputs[0].name.split("/").pop());
    return;
  }
  const btn = els.downloadAll;
  const label = btn.lastChild.textContent;
  btn.disabled = true;
  btn.lastChild.textContent = "Zipping";
  try {
    await saveZip(outputs, "stl-files.zip");
  } catch {
    showNotice("Could not build the ZIP. Try downloading files one at a time.");
  } finally {
    btn.lastChild.textContent = label;
    btn.disabled = false;
  }
}

/* ---------- Preview ---------- */

let previewModule;
let closePreview = null;

async function openPreview(item) {
  els.previewTitle.textContent = item.file.name;
  els.previewStage.classList.remove("is-ready");
  els.preview.showModal();
  try {
    previewModule ??= import("/assets/preview.js");
    const { mountPreview } = await previewModule;
    if (!els.preview.open) return;
    closePreview = mountPreview(els.previewStage, item.outputs.map((o) => o.data));
    els.previewStage.classList.add("is-ready");
  } catch {
    els.previewTitle.textContent = "Preview could not load. Your browser may not support WebGL.";
  }
}

els.preview.addEventListener("close", () => {
  if (closePreview) closePreview();
  closePreview = null;
});
els.previewClose.addEventListener("click", () => els.preview.close());
els.preview.addEventListener("click", (e) => { if (e.target === els.preview) els.preview.close(); });

/* ---------- Events ---------- */

els.input.addEventListener("change", () => {
  addFiles(els.input.files);
  els.input.value = "";
});

// Warm up the engine as soon as someone shows intent, so the first file converts sooner.
["pointerenter", "focusin", "dragenter"].forEach((type) =>
  els.converter.addEventListener(type, () => pool.warmup(), { once: true })
);

// Accept drops anywhere on the page.
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropzone.classList.add("is-dragging");
});
window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) els.dropzone.classList.remove("is-dragging");
});
window.addEventListener("drop", async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.dropzone.classList.remove("is-dragging");
  const entries = Array.from(e.dataTransfer.items || [])
    .map((item) => item.webkitGetAsEntry && item.webkitGetAsEntry())
    .filter(Boolean);
  if (entries.some((entry) => entry.isDirectory)) {
    const files = (await Promise.all(entries.map(readEntry))).flat();
    addFiles(files);
  } else {
    addFiles(e.dataTransfer.files);
  }
});

// Walk dropped folders (including subfolders) and collect the files inside.
async function readEntry(entry) {
  if (entry.isFile) return new Promise((resolve) => entry.file((f) => resolve([f]), () => resolve([])));
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = [];
  // readEntries returns results in batches, so keep reading until it comes back empty.
  for (;;) {
    const batch = await new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map(readEntry))).flat();
}

document.querySelectorAll('input[name="quality"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    settings.quality = radio.value;
    els.qualityHint.textContent = QUALITY_HINTS[radio.value];
    renderSummary();
  })
);
els.split.addEventListener("change", () => {
  settings.splitBodies = els.split.checked;
  renderSummary();
});

els.reapplyBtn.addEventListener("click", () => {
  for (const item of items.values()) {
    if ((item.status === "done" || item.status === "error") && item.settingsKey !== settingsKey()) convert(item);
  }
});

els.queue.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const item = items.get(btn.closest(".row").dataset.id);
  if (!item) return;
  const action = btn.dataset.action;
  if (action === "remove") {
    items.delete(item.id);
    item.el.remove();
    renderSummary();
  } else if (action === "download" && item.status === "done") {
    downloadItem(item);
  } else if (action === "preview" && item.status === "done") {
    openPreview(item);
  }
});

els.clearBtn.addEventListener("click", () => {
  items.clear();
  els.queue.replaceChildren();
  showNotice("");
  renderSummary();
});

els.downloadAll.addEventListener("click", downloadAll);
