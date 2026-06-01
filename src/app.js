import { analyzeCrashReport, parseCrashReport } from "./crashParser.js";
import { applyStaticTranslations } from "./i18n/dom.js";
import { t } from "./i18n/en.js";

const state = {
  samples: [],
  activeSample: "",
  activeTab: "summary",
  query: "",
  showSystemFrames: true,
  parsed: null,
  analysis: null,
  error: null,
  source: "",
  sidebarHidden: false,
  theme: "light",
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
  printReport: document.querySelector("#printReport"),
  clearReport: document.querySelector("#clearReport"),
  emptyState: document.querySelector("#emptyState"),
  errorState: document.querySelector("#errorState"),
  reportView: document.querySelector("#reportView"),
  printView: document.querySelector("#printView"),
  tabs: document.querySelectorAll(".tab"),
  sidebarToggle: document.querySelector("#sidebarToggle"),
  themeToggle: document.querySelector("#themeToggle"),
};

init();

async function init() {
  applyStaticTranslations();
  wireEvents();
  setSidebarHidden(false);
  setTheme("light");
  trackStatEvent("page_view");
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
      activateTab(tab.dataset.tab);
    });
    tab.addEventListener("keydown", (event) => {
      handleTabKeydown(event, tab);
    });
  });

  els.copySummary.addEventListener("click", copySummary);
  els.downloadJson.addEventListener("click", downloadAnalysisJson);
  els.printReport.addEventListener("click", printCurrentReport);
  els.clearReport.addEventListener("click", clearReport);
  els.sidebarToggle.addEventListener("click", () => setSidebarHidden(!state.sidebarHidden));
  els.themeToggle.addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
}

function setSidebarHidden(hidden) {
  state.sidebarHidden = hidden;
  els.body.classList.toggle("focus-mode", hidden);
  els.sidebarToggle.setAttribute("aria-expanded", String(!hidden));
  const label = t(hidden ? "actions.showSidebar" : "actions.hideSidebar");
  els.sidebarToggle.setAttribute("aria-label", label);
  els.sidebarToggle.title = label;
}

function setTheme(theme) {
  state.theme = theme;
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = theme;
  els.themeToggle.setAttribute("aria-pressed", String(isDark));
  const label = t(isDark ? "actions.switchToLightMode" : "actions.switchToDarkMode");
  els.themeToggle.setAttribute("aria-label", label);
  els.themeToggle.title = label;
}

function activateTab(tabName, { focus = false } = {}) {
  state.activeTab = tabName;
  if (state.analysis) {
    renderReport();
  } else {
    syncTabs();
  }
  if (focus) {
    const activeTab = [...els.tabs].find((tab) => tab.dataset.tab === tabName);
    activeTab?.focus();
  }
}

function handleTabKeydown(event, activeTab) {
  const tabs = [...els.tabs];
  const index = tabs.indexOf(activeTab);
  if (index < 0) return;

  const keys = {
    ArrowLeft: (index - 1 + tabs.length) % tabs.length,
    ArrowRight: (index + 1) % tabs.length,
    Home: 0,
    End: tabs.length - 1,
  };

  if (!(event.key in keys)) return;
  event.preventDefault();
  activateTab(tabs[keys[event.key]].dataset.tab, { focus: true });
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
    els.sampleList.innerHTML = `<p class="muted">${escapeHtml(t("samples.empty"))}</p>`;
    return;
  }

  els.sampleList.innerHTML = state.samples.map((sample) => `
    <button class="sample-button ${sample.name === state.activeSample ? "is-active" : ""}" type="button" data-file="${escapeAttr(sample.name)}" aria-current="${sample.name === state.activeSample ? "true" : "false"}">
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
    loadText(text, fileName, "sample");
    state.activeSample = fileName;
    renderSamples();
  } catch (error) {
    setError(error);
  }
}

async function loadFile(file) {
  try {
    const text = await file.text();
    loadText(text, file.name, "upload");
    state.activeSample = "";
    renderSamples();
  } catch (error) {
    setError(error);
  } finally {
    els.fileInput.value = "";
  }
}

function loadText(text, fileName, source = "") {
  try {
    const parsed = parseCrashReport(text, { fileName });
    const analysis = analyzeCrashReport(parsed);
    state.parsed = parsed;
    state.analysis = analysis;
    state.error = null;
    state.source = source;
    state.activeTab = "summary";
    trackStatEvent("report_analyzed");
    if (source === "sample") {
      trackStatEvent("sample_report_analyzed");
    } else {
      trackStatEvent("browser_report_analyzed");
    }
    render();
  } catch (error) {
    state.parsed = null;
    state.analysis = null;
    state.source = "";
    trackStatEvent("parse_error");
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
  els.printReport.disabled = !hasReport;
  els.clearReport.disabled = !hasReport && !hasError;
  syncTabs();

  if (hasError) {
    els.reportTitle.textContent = t("error.parseTitle");
    els.statusBox.className = "status-box error";
    els.statusBox.textContent = state.error.message;
    els.errorState.innerHTML = `
      <h2>${escapeHtml(t("error.title"))}</h2>
      <p>${escapeHtml(state.error.message)}</p>
    `;
    els.printView.innerHTML = "";
    return;
  }

  if (!hasReport) {
    els.reportTitle.textContent = t("app.noReportLoaded");
    els.statusBox.className = "status-box";
    els.statusBox.textContent = t("status.waiting");
    els.printView.innerHTML = "";
    return;
  }

  const { analysis } = state;
  const processName = analysis.identity.process || t("app.fallbackReportTitle");
  els.reportTitle.textContent = `${analysis.identity.process || t("app.fallbackReportTitle")}${analysis.fileName ? ` · ${analysis.fileName}` : ""}`;
  els.statusBox.className = "status-box ok";
  els.statusBox.textContent = state.source === "upload"
    ? t("status.uploadParsed", { process: processName })
    : t("status.sampleParsed", { process: processName, frameCount: analysis.crashedThread.frames.length });
  renderReport();
  renderPrintReport();
}

function clearReport() {
  state.activeSample = "";
  state.activeTab = "summary";
  state.parsed = null;
  state.analysis = null;
  state.error = null;
  state.source = "";
  state.query = "";
  state.showSystemFrames = true;
  els.searchInput.value = "";
  els.systemFramesToggle.checked = true;
  els.fileInput.value = "";
  renderSamples();
  render();
}

function renderReport() {
  if (!state.analysis) return;
  els.reportView.setAttribute("aria-busy", "true");
  syncTabs();

  if (state.activeTab === "threads") {
    els.reportView.innerHTML = renderThreads();
  } else if (state.activeTab === "images") {
    els.reportView.innerHTML = renderImages();
  } else if (state.activeTab === "raw") {
    els.reportView.innerHTML = renderRaw();
  } else {
    els.reportView.innerHTML = renderSummary();
  }
  els.reportView.setAttribute("aria-busy", "false");
}

function renderPrintReport() {
  if (!state.analysis) {
    els.printView.innerHTML = "";
    return;
  }

  const { analysis } = state;
  const originalQuery = state.query;
  const originalShowSystemFrames = state.showSystemFrames;

  const title = `${analysis.identity.process || t("app.fallbackReportTitle")}${analysis.fileName ? ` - ${analysis.fileName}` : ""}`;
  const generatedAt = new Date().toLocaleString();
  const metadata = definitionList([
    [t("report.fields.process"), processLine(analysis)],
    [t("report.fields.bundleId"), analysis.identity.bundleId],
    [t("report.fields.version"), analysis.identity.version],
    [t("report.fields.osVersion"), analysis.environment.osVersion],
    [t("report.fields.hardware"), analysis.environment.model],
    [t("report.fields.crashTime"), analysis.environment.crashedAt],
    [t("report.print.sourceFile"), analysis.fileName],
  ]);

  let summary;
  let threads;
  let images;
  try {
    state.query = "";
    state.showSystemFrames = true;
    summary = renderSummary();
    threads = renderThreads();
    images = renderImages();
  } finally {
    state.query = originalQuery;
    state.showSystemFrames = originalShowSystemFrames;
  }

  els.printView.innerHTML = `
    <article class="print-report">
      <header class="print-report-header">
        <div>
          <p class="kicker">${escapeHtml(t("app.name"))}</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(t("report.print.generatedAt", { timestamp: generatedAt }))}</p>
        </div>
        <div class="print-report-meta">
          ${metadata}
        </div>
      </header>
      <div class="print-report-body">
        ${summary}
      </div>
      <section class="print-page-block">
        <h2>${escapeHtml(t("report.print.fullThreads"))}</h2>
        ${threads}
      </section>
      <section class="print-page-block">
        ${images}
      </section>
      <footer class="print-report-footer">
        ${escapeHtml(t("report.print.generatedBy"))}
      </footer>
    </article>
  `;
}

function syncTabs() {
  els.tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === state.activeTab;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
    if (isActive) els.reportView.setAttribute("aria-labelledby", tab.id);
  });
}

function renderSummary() {
  const { analysis } = state;
  const runtime = typeof analysis.runtimeSeconds === "number" ? `${analysis.runtimeSeconds.toFixed(2)} sec` : t("report.summary.unknownRuntime");
  const notes = [...analysis.exception.notes];
  if (analysis.lastException.present) notes.push(t("report.summary.lastException"));
  if (!analysis.symbolication.fullySymbolicated) notes.push(t("report.summary.unsymbolicatedFrames", { count: analysis.symbolication.unsymbolicatedFrames }));

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
          <span class="status-pill">${highlight(analysis.environment.platform || t("report.summary.unknownPlatform"))}</span>
          <span class="status-pill warn">${escapeHtml(t("report.summary.runtime", { runtime }))}</span>
          ${notes.map((note) => `<span class="status-pill warn">${highlight(note)}</span>`).join("")}
        </div>
      </section>

      ${renderRootCauseGuide(analysis.rootCause)}
      ${renderCrashStory(analysis.crashStory)}
      ${renderSymbolicationReadiness(analysis.symbolication)}
      ${renderCollectionContext(analysis.collectionContext)}

      <section class="panel">
        <h3 class="section-title">${escapeHtml(t("report.summary.environment"))}</h3>
        ${definitionList([
          [t("report.fields.process"), processLine(analysis)],
          [t("report.fields.bundleId"), analysis.identity.bundleId],
          [t("report.fields.version"), analysis.identity.version],
          [t("report.fields.osVersion"), analysis.environment.osVersion],
          [t("report.fields.hardware"), analysis.environment.model],
          [t("report.fields.architecture"), analysis.environment.cpuType],
          [t("report.fields.role"), analysis.environment.role],
          [t("report.fields.parent"), analysis.environment.parentProcess],
          [t("report.fields.launchTime"), analysis.environment.launchedAt],
          [t("report.fields.crashTime"), analysis.environment.crashedAt],
        ])}
      </section>

      <section class="panel">
        <h3 class="section-title">${escapeHtml(t("report.summary.exceptionTermination"))}</h3>
        ${definitionList([
          [t("report.fields.exceptionType"), `${analysis.exception.type} ${analysis.exception.signal ? `(${analysis.exception.signal})` : ""}`],
          [t("report.fields.codes"), analysis.exception.codes],
          [t("report.fields.subtype"), analysis.exception.subtype],
          [t("report.fields.message"), analysis.exception.message],
          [t("report.fields.termination"), `${analysis.exception.terminationNamespace} ${analysis.exception.terminationCode ?? ""} ${analysis.exception.terminationIndicator}`],
          [t("report.fields.terminator"), analysis.exception.terminatingProcess],
          [t("report.fields.triggeredThread"), String(analysis.crashedThread.index)],
        ])}
      </section>

      <section class="panel">
        <h3 class="section-title">${escapeHtml(t("report.summary.binaryImageSummary"))}</h3>
        ${definitionList([
          [t("report.fields.images"), String(analysis.binarySummary.counts.total)],
          [t("report.fields.processImages"), String(analysis.binarySummary.counts.process)],
          [t("report.fields.systemImages"), String(analysis.binarySummary.counts.system)],
          [t("report.fields.privateFrameworks"), String(analysis.binarySummary.counts.privateFrameworks)],
          [t("report.fields.thirdPartyUser"), String(analysis.binarySummary.counts.thirdPartyOrUser)],
          [t("report.fields.symbolication"), analysis.symbolication.fullySymbolicated ? t("report.fields.noUnsymbolicatedFrames") : t("report.summary.unsymbolicatedFrames", { count: analysis.symbolication.unsymbolicatedFrames })],
        ])}
      </section>
    </div>

    <section class="section">
      <div class="section-header">
        <h3 class="section-title">${escapeHtml(t("report.summary.crashedThread"))}</h3>
        <p>${highlight(analysis.crashedThread.queue || analysis.crashedThread.name || t("report.summary.noThreadLabel"))}</p>
      </div>
      ${framesTable(filterFrames(analysis.crashedThread.frames).slice(0, 24))}
    </section>

    <section class="section">
      <div class="section-header">
        <h3 class="section-title">${escapeHtml(t("report.summary.diagnosticMessages"))}</h3>
        <p>${analysis.diagnostics.length ? escapeHtml(t("report.summary.messages", { count: analysis.diagnostics.length })) : escapeHtml(t("report.summary.noMessages"))}</p>
      </div>
      ${diagnosticsList(analysis.diagnostics)}
    </section>

    <section class="section">
      <div class="section-header">
        <h3 class="section-title">${escapeHtml(t("report.summary.recommendedNextActions"))}</h3>
      </div>
      <ol class="recommendations">
        ${analysis.recommendations.map((item, index) => `<li><strong>${escapeHtml(t("report.summary.step", { number: index + 1 }))}</strong>${highlight(item)}</li>`).join("")}
      </ol>
    </section>
  `;
}

function renderCrashStory(crashStory) {
  if (!crashStory?.checks?.length) return "";

  return `
    <section class="panel">
      <h3 class="section-title">${escapeHtml(t("report.summary.crashStory"))}</h3>
      ${crashStory.verdict ? `<p class="panel-intro">${highlight(crashStory.verdict)}</p>` : ""}
      <ul class="diagnostic-list">
        ${crashStory.checks.map((check) => `
          <li>
            <strong>${renderReferenceLink(check.label, check.referenceUrl)}${check.status ? ` · ${highlight(check.status)}` : ""}</strong>
            ${highlight(check.detail)}
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderRootCauseGuide(rootCause) {
  if (!rootCause) return "";

  return `
    <section class="panel root-guide">
      <div class="section-header">
        <h3 class="section-title">${escapeHtml(t("report.summary.rootCauseGuide"))}</h3>
        <span class="status-pill ${rootCause.confidence === "high" ? "danger" : "warn"}">${escapeHtml(t("report.summary.confidence", { confidence: rootCause.confidence || t("report.copy.unknown") }))}</span>
      </div>
      <h4>${highlight(rootCause.headline || t("report.summary.needsCorrelation"))}</h4>
      <p>${highlight(rootCause.summary || "")}</p>
      <div class="clue-grid">
        ${(rootCause.signals ?? []).map((signal) => `
          <article class="clue-card">
            <strong>${renderReferenceLink(signal.label, signal.referenceUrl)}</strong>
            <code>${highlight(signal.value || "Not present")}</code>
            <span>${highlight(signal.meaning)}</span>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderSymbolicationReadiness(symbolication) {
  if (!symbolication) return "";
  const missingImages = symbolication.missingImageUuids ?? [];

  return `
    <section class="panel">
      <h3 class="section-title">${escapeHtml(t("report.summary.symbolicationReadiness"))}</h3>
      ${definitionList([
        [t("report.fields.symbolicationStatus"), symbolication.fullySymbolicated ? t("report.fields.ready") : t("report.fields.needsDsym"), symbolication.referenceUrl],
        [t("report.fields.checkedFrames"), String(symbolication.totalFramesChecked ?? 0)],
        [t("report.fields.unsymbolicatedFrames"), String(symbolication.unsymbolicatedFrames ?? 0)],
        [t("report.fields.symbolicationAdvice"), symbolication.advice, symbolication.referenceUrl],
      ])}
      ${missingImages.length ? `
        <ul class="diagnostic-list compact-list">
          ${missingImages.map((image) => `
            <li>
              <strong>${highlight(image.name || t("report.copy.unknownImage"))}</strong>
              <span class="mono">${highlight([image.uuid, image.arch, image.path].filter(Boolean).join(" · "))}</span>
            </li>
          `).join("")}
        </ul>
      ` : `<p class="muted panel-note">${escapeHtml(t("report.fields.noMissingDsyms"))}</p>`}
    </section>
  `;
}

function renderCollectionContext(context) {
  if (!context) return "";

  return `
    <section class="panel">
      <h3 class="section-title">${escapeHtml(t("report.summary.collectionContext"))}</h3>
      <p class="panel-intro">${highlight(context.summary || "")}</p>
      ${definitionList([
        [t("report.fields.primarySource"), context.primarySource, context.relatedSources?.[0]?.url],
        [t("report.fields.bugType"), context.bugType, "https://developer.apple.com/documentation/xcode/interpreting-the-json-format-of-a-crash-report"],
        [t("report.fields.incident"), context.incident],
      ])}
      <h4 class="subsection-title">${escapeHtml(t("report.summary.relatedSources"))}</h4>
      <ul class="diagnostic-list compact-list">
        ${(context.relatedSources ?? []).map((source) => `
          <li>
            <strong>${renderReferenceLink(source.label, source.url)}</strong>
            ${highlight(source.detail)}
          </li>
        `).join("")}
      </ul>
    </section>
  `;
}

function renderThreads() {
  const threads = state.parsed.report.threads ?? [];
  if (!threads.length) return `<section class="section"><h3 class="section-title">${escapeHtml(t("report.summary.noThreadsFound"))}</h3></section>`;

  return `
    <div class="thread-stack">
      ${threads.map((thread, index) => {
        const frames = filterFrames((thread.frames ?? []).map((frame) => state.analysis.raw.report.usedImages ? normalizeFrame(frame) : frame));
        return `
          <section class="thread-card">
            <div class="thread-title">
              <h3>${escapeHtml(t("report.summary.thread", { index }))}${thread.triggered ? ` ${escapeHtml(t("report.summary.crashed"))}` : ""}</h3>
              ${thread.queue ? `<span class="status-pill">${highlight(thread.queue)}</span>` : ""}
              ${thread.name ? `<span class="status-pill">${highlight(thread.name)}</span>` : ""}
              <span class="status-pill">${escapeHtml(t("report.summary.framesShown", { count: frames.length }))}</span>
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
        <h3 class="section-title">${escapeHtml(t("report.summary.binaryImages"))}</h3>
        <p>${escapeHtml(t("report.summary.imagesShown", { shown: images.length, total: (state.parsed.report.usedImages ?? []).length }))}</p>
      </div>
      <div class="table-wrap" tabindex="0" role="region" aria-label="${escapeAttr(t("report.table.binaryImagesRegion"))}">
        <table>
          <thead><tr><th>${escapeHtml(t("report.table.name"))}</th><th>${escapeHtml(t("report.table.identifier"))}</th><th>${escapeHtml(t("report.table.version"))}</th><th>${escapeHtml(t("report.table.arch"))}</th><th>${escapeHtml(t("report.table.base"))}</th><th>${escapeHtml(t("report.table.size"))}</th><th>${escapeHtml(t("report.table.uuid"))}</th><th>${escapeHtml(t("report.table.path"))}</th></tr></thead>
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
  if (!frames.length) return `<p class="muted">${escapeHtml(t("report.summary.noFramesMatch"))}</p>`;
  return `
    <div class="table-wrap" tabindex="0" role="region" aria-label="${escapeAttr(t("report.table.stackFramesRegion"))}">
      <table>
        <thead><tr><th>${escapeHtml(t("report.table.index"))}</th><th>${escapeHtml(t("report.table.address"))}</th><th>${escapeHtml(t("report.table.image"))}</th><th>${escapeHtml(t("report.table.symbol"))}</th><th>${escapeHtml(t("report.table.offset"))}</th><th>${escapeHtml(t("report.table.path"))}</th></tr></thead>
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
  if (!diagnostics.length) return `<p class="muted">${escapeHtml(t("report.summary.noDiagnosticMessages"))}</p>`;
  return `
    <ul class="diagnostic-list">
      ${diagnostics.map((item) => `<li><strong>${highlight(item.source)}</strong>${highlight(item.message)}</li>`).join("")}
    </ul>
  `;
}

function definitionList(items) {
  return `
    <dl class="definition-list">
      ${items.map(([key, value, referenceUrl]) => `
        <dt>${renderReferenceLink(key, referenceUrl)}</dt>
        <dd>${value ? highlight(String(value)) : `<span class="muted">${escapeHtml(t("report.fields.notPresent"))}</span>`}</dd>
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
    imageName: image.name || basename(image.path) || t("report.copy.unknownImage"),
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
    `${t("report.copy.category")}: ${analysis.exception.category}`,
    `${t("report.copy.rootCauseGuide")}: ${analysis.rootCause?.headline || t("report.copy.notAvailable")}`,
    `${t("report.copy.rootCauseSummary")}: ${analysis.rootCause?.summary || t("report.copy.notAvailable")}`,
    `${t("report.copy.hypothesis")}: ${analysis.hypothesis}`,
    `${t("report.copy.topFrame")}: ${analysis.crashedThread.frames[0]?.symbol || t("report.copy.unknown")} in ${analysis.crashedThread.frames[0]?.imageName || t("report.copy.unknownImage")}`,
    `${t("report.copy.recommendations")}:`,
    ...analysis.recommendations.map((item) => `- ${item}`),
  ].join("\n");
  await navigator.clipboard.writeText(text);
  trackStatEvent("summary_copied");
  flashStatus(t("status.summaryCopied"));
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
  trackStatEvent("json_export");
  flashStatus(t("status.jsonExported"));
}

function printCurrentReport() {
  if (!state.analysis) return;
  renderPrintReport();
  trackStatEvent("print_opened");
  flashStatus(t("status.printReady"));
  window.print();
}

function trackStatEvent(eventName) {
  return fetch("/api/stats/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: eventName }),
    keepalive: true,
  }).catch(() => {});
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

function renderReferenceLink(label, url) {
  const safeUrl = safeReferenceUrl(url);
  if (!safeUrl) return highlight(label);
  return `<a class="reference-link external-link" href="${escapeAttr(safeUrl)}" target="_blank" rel="noopener noreferrer">${highlight(label)}</a>`;
}

function safeReferenceUrl(url) {
  const value = String(url ?? "");
  return value.startsWith("https://developer.apple.com/") ? value : "";
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
