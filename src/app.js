import { analyzeCrashReport, parseCrashReport } from "./crashParser.js";

const state = {
  samples: [],
  activeSample: "",
  activeTab: "summary",
  query: "",
  showSystemFrames: true,
  parsed: null,
  analysis: null,
  error: null,
};

const els = {
  body: document.body,
  sampleList: document.querySelector("#sampleList"),
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  searchInput: document.querySelector("#searchInput"),
  systemFramesToggle: document.querySelector("#systemFramesToggle"),
  clearFilters: document.querySelector("#clearFilters"),
  statusBox: document.querySelector("#statusBox"),
  reportTitle: document.querySelector("#reportTitle"),
  copySummary: document.querySelector("#copySummary"),
  downloadJson: document.querySelector("#downloadJson"),
  emptyState: document.querySelector("#emptyState"),
  errorState: document.querySelector("#errorState"),
  reportView: document.querySelector("#reportView"),
  tabs: document.querySelectorAll(".tab"),
  focusToggle: document.querySelector("#focusToggle"),
};

init();

async function init() {
  wireEvents();
  await loadSamples();
  if (state.samples.length) {
    await loadSample(state.samples[0].name);
  } else {
    render();
  }
}

function wireEvents() {
  els.fileInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (file) await loadFile(file);
  });

  for (const eventName of ["dragenter", "dragover"]) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragging");
    });
  }

  els.dropZone.addEventListener("drop", async (event) => {
    const [file] = event.dataTransfer.files;
    if (file) await loadFile(file);
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim();
    renderReport();
  });

  els.systemFramesToggle.addEventListener("change", () => {
    state.showSystemFrames = els.systemFramesToggle.checked;
    renderReport();
  });

  els.clearFilters.addEventListener("click", () => {
    state.query = "";
    state.showSystemFrames = true;
    els.searchInput.value = "";
    els.systemFramesToggle.checked = true;
    renderReport();
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeTab = tab.dataset.tab;
      renderReport();
    });
  });

  els.copySummary.addEventListener("click", copySummary);
  els.downloadJson.addEventListener("click", downloadAnalysisJson);
  els.focusToggle.addEventListener("click", () => {
    els.body.classList.toggle("focus-mode");
  });
}

async function loadSamples() {
  try {
    const response = await fetch("/api/samples");
    if (!response.ok) throw new Error(`Sample API returned ${response.status}`);
    state.samples = await response.json();
  } catch {
    state.samples = [];
  }
  renderSamples();
}

function renderSamples() {
  if (!state.samples.length) {
    els.sampleList.innerHTML = `<p class="muted">No local samples found.</p>`;
    return;
  }

  els.sampleList.innerHTML = state.samples.map((sample) => `
    <button class="sample-button ${sample.name === state.activeSample ? "is-active" : ""}" type="button" data-file="${escapeAttr(sample.name)}">
      <span class="sample-name">${highlight(sample.name)}</span>
      <span class="sample-meta">${formatBytes(sample.size)} · ${escapeHtml(sample.modified)}</span>
    </button>
  `).join("");

  els.sampleList.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => loadSample(button.dataset.file));
  });
}

async function loadSample(fileName) {
  try {
    const response = await fetch(`/api/sample?file=${encodeURIComponent(fileName)}`);
    if (!response.ok) throw new Error(`Could not load sample ${fileName}`);
    const text = await response.text();
    loadText(text, fileName);
    state.activeSample = fileName;
    renderSamples();
  } catch (error) {
    setError(error);
  }
}

async function loadFile(file) {
  try {
    const text = await file.text();
    loadText(text, file.name);
    state.activeSample = "";
    renderSamples();
  } catch (error) {
    setError(error);
  } finally {
    els.fileInput.value = "";
  }
}

function loadText(text, fileName) {
  try {
    const parsed = parseCrashReport(text, { fileName });
    const analysis = analyzeCrashReport(parsed);
    state.parsed = parsed;
    state.analysis = analysis;
    state.error = null;
    state.activeTab = "summary";
    render();
  } catch (error) {
    state.parsed = null;
    state.analysis = null;
    setError(error);
  }
}

function setError(error) {
  state.error = error;
  render();
}

function render() {
  const hasReport = Boolean(state.analysis);
  const hasError = Boolean(state.error);

  els.emptyState.hidden = hasReport || hasError;
  els.errorState.hidden = !hasError;
  els.reportView.hidden = !hasReport;
  els.copySummary.disabled = !hasReport;
  els.downloadJson.disabled = !hasReport;

  if (hasError) {
    els.reportTitle.textContent = "Could not parse report";
    els.statusBox.className = "status-box error";
    els.statusBox.textContent = state.error.message;
    els.errorState.innerHTML = `
      <h2>Unsupported or invalid crash report.</h2>
      <p>${escapeHtml(state.error.message)}</p>
    `;
    return;
  }

  if (!hasReport) {
    els.reportTitle.textContent = "No report loaded";
    els.statusBox.className = "status-box";
    els.statusBox.textContent = "Waiting for a crash report.";
    return;
  }

  const { analysis } = state;
  els.reportTitle.textContent = `${analysis.identity.process || "Crash Report"}${analysis.fileName ? ` · ${analysis.fileName}` : ""}`;
  els.statusBox.className = "status-box ok";
  els.statusBox.textContent = `${analysis.identity.process} parsed successfully. ${analysis.crashedThread.frames.length} crashed-thread frames.`;
  renderReport();
}

function renderReport() {
  if (!state.analysis) return;

  els.tabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
  });

  if (state.activeTab === "threads") {
    els.reportView.innerHTML = renderThreads();
  } else if (state.activeTab === "images") {
    els.reportView.innerHTML = renderImages();
  } else if (state.activeTab === "raw") {
    els.reportView.innerHTML = renderRaw();
  } else {
    els.reportView.innerHTML = renderSummary();
  }
}

function renderSummary() {
  const { analysis } = state;
  const runtime = typeof analysis.runtimeSeconds === "number" ? `${analysis.runtimeSeconds.toFixed(2)} sec` : "Unknown";
  const notes = [...analysis.exception.notes];
  if (analysis.lastException.present) notes.push("Last Exception Backtrace");
  if (!analysis.symbolication.fullySymbolicated) notes.push(`${analysis.symbolication.unsymbolicatedFrames} unsymbolicated frames`);

  return `
    <div class="summary-grid">
      <section class="verdict">
        <div class="verdict-head">
          <div class="signal">!</div>
          <div>
            <h3>${highlight(analysis.exception.type || "Unknown exception")} <span class="mono muted">${highlight(analysis.exception.signal || "")}</span></h3>
            <p>${highlight(analysis.hypothesis)}</p>
          </div>
        </div>
        <div class="status-row">
          <span class="status-pill danger">${highlight(analysis.exception.category)}</span>
          <span class="status-pill">${highlight(analysis.environment.platform || "Unknown platform")}</span>
          <span class="status-pill warn">Runtime ${escapeHtml(runtime)}</span>
          ${notes.map((note) => `<span class="status-pill warn">${highlight(note)}</span>`).join("")}
        </div>
      </section>

      ${renderRootCauseGuide(analysis.rootCause)}

      <section class="panel">
        <h3 class="section-title">Environment</h3>
        ${definitionList([
          ["Process", processLine(analysis)],
          ["Bundle ID", analysis.identity.bundleId],
          ["Version", analysis.identity.version],
          ["OS Version", analysis.environment.osVersion],
          ["Hardware", analysis.environment.model],
          ["Architecture", analysis.environment.cpuType],
          ["Role", analysis.environment.role],
          ["Parent", analysis.environment.parentProcess],
          ["Launch Time", analysis.environment.launchedAt],
          ["Crash Time", analysis.environment.crashedAt],
        ])}
      </section>

      <section class="panel">
        <h3 class="section-title">Exception / Termination</h3>
        ${definitionList([
          ["Exception Type", `${analysis.exception.type} ${analysis.exception.signal ? `(${analysis.exception.signal})` : ""}`],
          ["Codes", analysis.exception.codes],
          ["Subtype", analysis.exception.subtype],
          ["Message", analysis.exception.message],
          ["Termination", `${analysis.exception.terminationNamespace} ${analysis.exception.terminationCode ?? ""} ${analysis.exception.terminationIndicator}`],
          ["Terminator", analysis.exception.terminatingProcess],
          ["Triggered Thread", String(analysis.crashedThread.index)],
        ])}
      </section>

      <section class="panel">
        <h3 class="section-title">Binary Image Summary</h3>
        ${definitionList([
          ["Images", String(analysis.binarySummary.counts.total)],
          ["Process Images", String(analysis.binarySummary.counts.process)],
          ["System Images", String(analysis.binarySummary.counts.system)],
          ["Private Frameworks", String(analysis.binarySummary.counts.privateFrameworks)],
          ["Third Party/User", String(analysis.binarySummary.counts.thirdPartyOrUser)],
          ["Symbolication", analysis.symbolication.fullySymbolicated ? "No unsymbolicated frames in checked stacks" : `${analysis.symbolication.unsymbolicatedFrames} unsymbolicated frames`],
        ])}
      </section>
    </div>

    <section class="section">
      <div class="section-header">
        <h3 class="section-title">Crashed Thread</h3>
        <p>${highlight(analysis.crashedThread.queue || analysis.crashedThread.name || "No thread label")}</p>
      </div>
      ${framesTable(filterFrames(analysis.crashedThread.frames).slice(0, 24))}
    </section>

    <section class="section">
      <div class="section-header">
        <h3 class="section-title">Diagnostic Messages</h3>
        <p>${analysis.diagnostics.length || "No"} messages</p>
      </div>
      ${diagnosticsList(analysis.diagnostics)}
    </section>

    <section class="section">
      <div class="section-header">
        <h3 class="section-title">Recommended Next Actions</h3>
      </div>
      <ol class="recommendations">
        ${analysis.recommendations.map((item, index) => `<li><strong>Step ${index + 1}</strong>${highlight(item)}</li>`).join("")}
      </ol>
    </section>
  `;
}

function renderRootCauseGuide(rootCause) {
  if (!rootCause) return "";

  return `
    <section class="panel root-guide">
      <div class="section-header">
        <h3 class="section-title">Root Cause Guide</h3>
        <span class="status-pill ${rootCause.confidence === "high" ? "danger" : "warn"}">${escapeHtml(rootCause.confidence || "unknown")} confidence</span>
      </div>
      <h4>${highlight(rootCause.headline || "Needs full-report correlation")}</h4>
      <p>${highlight(rootCause.summary || "")}</p>
      <div class="clue-grid">
        ${(rootCause.signals ?? []).map((signal) => `
          <article class="clue-card">
            <strong>${highlight(signal.label)}</strong>
            <code>${highlight(signal.value || "Not present")}</code>
            <span>${highlight(signal.meaning)}</span>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderThreads() {
  const threads = state.parsed.report.threads ?? [];
  if (!threads.length) return `<section class="section"><h3 class="section-title">No threads found</h3></section>`;

  return `
    <div class="thread-stack">
      ${threads.map((thread, index) => {
        const frames = filterFrames((thread.frames ?? []).map((frame) => state.analysis.raw.report.usedImages ? normalizeFrame(frame) : frame));
        return `
          <section class="thread-card">
            <div class="thread-title">
              <h3>Thread ${index}${thread.triggered ? " Crashed" : ""}</h3>
              ${thread.queue ? `<span class="status-pill">${highlight(thread.queue)}</span>` : ""}
              ${thread.name ? `<span class="status-pill">${highlight(thread.name)}</span>` : ""}
              <span class="status-pill">${frames.length} frames shown</span>
            </div>
            ${framesTable(frames)}
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function renderImages() {
  const images = filterImages(state.parsed.report.usedImages ?? []);
  return `
    <section class="section">
      <div class="section-header">
        <h3 class="section-title">Binary Images</h3>
        <p>${images.length} of ${(state.parsed.report.usedImages ?? []).length} shown</p>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Identifier</th><th>Version</th><th>Arch</th><th>Base</th><th>Size</th><th>UUID</th><th>Path</th></tr></thead>
          <tbody>
            ${images.map((image) => `
              <tr>
                <td>${highlight(image.name || basename(image.path))}</td>
                <td>${highlight(image.CFBundleIdentifier || "")}</td>
                <td>${highlight(versionString(image))}</td>
                <td>${highlight(image.arch || "")}</td>
                <td>${highlight(numberHex(image.base))}</td>
                <td>${highlight(formatBytes(image.size || 0))}</td>
                <td>${highlight(image.uuid || "")}</td>
                <td>${highlight(image.path || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRaw() {
  const raw = JSON.stringify({
    metadata: state.parsed.metadata,
    report: state.parsed.report,
    analysis: withoutRaw(state.analysis),
  }, null, 2);
  return `<pre class="raw-pre">${escapeHtml(raw)}</pre>`;
}

function framesTable(frames) {
  if (!frames.length) return `<p class="muted">No frames match the current filters.</p>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Address</th><th>Image</th><th>Symbol</th><th>Offset</th><th>Path</th></tr></thead>
        <tbody>
          ${frames.map((frame, index) => `
            <tr>
              <td>${frame.index ?? index}</td>
              <td>${highlight(frame.address || "")}</td>
              <td>${highlight(frame.imageName || "")}</td>
              <td>${highlight(frame.symbol || "")}</td>
              <td>${highlight(frame.symbolLocation === null || frame.symbolLocation === undefined ? "" : `+ ${frame.symbolLocation}`)}</td>
              <td>${highlight(frame.imagePath || "")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function diagnosticsList(diagnostics) {
  if (!diagnostics.length) return `<p class="muted">No diagnostic messages were included in this report.</p>`;
  return `
    <ul class="diagnostic-list">
      ${diagnostics.map((item) => `<li><strong>${highlight(item.source)}</strong>${highlight(item.message)}</li>`).join("")}
    </ul>
  `;
}

function definitionList(items) {
  return `
    <dl class="definition-list">
      ${items.map(([key, value]) => `
        <dt>${escapeHtml(key)}</dt>
        <dd>${value ? highlight(String(value)) : '<span class="muted">Not present</span>'}</dd>
      `).join("")}
    </dl>
  `;
}

function normalizeFrame(frame) {
  const images = state.parsed.report.usedImages ?? [];
  const image = images[frame.imageIndex] ?? {};
  const address = Number.isFinite(Number(frame.imageOffset)) && Number.isFinite(Number(image.base))
    ? numberHex(Number(frame.imageOffset) + Number(image.base))
    : "";
  return {
    imageIndex: frame.imageIndex,
    imageName: image.name || basename(image.path) || "Unknown image",
    imagePath: image.path || "",
    address,
    symbol: frame.symbol || "<unsymbolicated>",
    symbolLocation: Number.isFinite(Number(frame.symbolLocation)) ? Number(frame.symbolLocation) : null,
  };
}

function filterFrames(frames) {
  return frames
    .filter((frame) => state.showSystemFrames || !isSystemPath(frame.imagePath))
    .filter((frame) => !state.query || searchable(frame).includes(state.query.toLowerCase()));
}

function filterImages(images) {
  return images
    .filter((image) => state.showSystemFrames || !isSystemPath(image.path))
    .filter((image) => !state.query || searchable(image).includes(state.query.toLowerCase()));
}

function searchable(value) {
  return JSON.stringify(value ?? "").toLowerCase();
}

function isSystemPath(path = "") {
  return path.startsWith("/System/") || path.startsWith("/usr/lib/");
}

async function copySummary() {
  if (!state.analysis) return;
  const { analysis } = state;
  const text = [
    `${analysis.identity.process}: ${analysis.exception.type} ${analysis.exception.signal ? `(${analysis.exception.signal})` : ""}`,
    `Category: ${analysis.exception.category}`,
    `Root cause guide: ${analysis.rootCause?.headline || "not available"}`,
    `Root cause summary: ${analysis.rootCause?.summary || "not available"}`,
    `Hypothesis: ${analysis.hypothesis}`,
    `Top frame: ${analysis.crashedThread.frames[0]?.symbol || "unknown"} in ${analysis.crashedThread.frames[0]?.imageName || "unknown image"}`,
    "Recommendations:",
    ...analysis.recommendations.map((item) => `- ${item}`),
  ].join("\n");
  await navigator.clipboard.writeText(text);
  flashStatus("Summary copied to clipboard.");
}

function downloadAnalysisJson() {
  if (!state.analysis) return;
  const json = JSON.stringify(withoutRaw(state.analysis), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.analysis.identity.process || "crash-report"}.analysis.json`;
  link.click();
  URL.revokeObjectURL(url);
  flashStatus("Analysis JSON exported.");
}

function flashStatus(message) {
  const original = els.statusBox.textContent;
  els.statusBox.textContent = message;
  window.setTimeout(() => {
    if (state.analysis) els.statusBox.textContent = original;
  }, 1800);
}

function withoutRaw(analysis) {
  const { raw, ...rest } = analysis;
  return rest;
}

function processLine(analysis) {
  return `${analysis.identity.process}${analysis.identity.pid ? ` [${analysis.identity.pid}]` : ""}`;
}

function versionString(value = {}) {
  const shortVersion = value.CFBundleShortVersionString || "";
  const build = value.CFBundleVersion || "";
  if (shortVersion && build && shortVersion !== build) return `${shortVersion} (${build})`;
  return shortVersion || build || "";
}

function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes))) return "";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function numberHex(value) {
  if (!Number.isFinite(Number(value))) return "";
  return `0x${Number(value).toString(16).padStart(16, "0")}`;
}

function basename(path = "") {
  return path.split("/").filter(Boolean).at(-1) || "";
}

function highlight(value) {
  const escaped = escapeHtml(String(value ?? ""));
  if (!state.query) return escaped;
  const needle = escapeRegExp(state.query);
  return escaped.replace(new RegExp(`(${needle})`, "gi"), "<mark>$1</mark>");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
