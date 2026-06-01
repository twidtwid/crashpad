import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("commits exactly one public example for QLThumbnail", async () => {
  const examples = (await readdir(new URL("../examples/", import.meta.url))).filter((name) => name.endsWith(".ips"));

  assert.deepEqual(examples, ["qlthumbnail.ips"]);
});

test("page exposes privacy policy, stats, repository link, and clear-report control", async () => {
  const html = await readProjectFile("index.html");

  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/stats"/);
  assert.match(html, /href="https:\/\/github\.com\/twidtwid\/crashpad"/);
  assert.match(html, /id="clearReport"/);
});

test("privacy copy distinguishes local file input from server upload routes and aggregate stats", async () => {
  const [index, privacy, stats, messages, readme] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("privacy.html"),
    readProjectFile("stats.html"),
    readProjectFile("src/i18n/en.js"),
    readProjectFile("README.md"),
  ]);

  assert.match(index, />Open \.ips \/ \.crash</);
  assert.match(privacy, /local browser inputs, not a network upload/);
  assert.match(messages, /has no route that receives crash report files/);
  assert.match(`${privacy}\n${messages}`, /non-identifiable aggregate stats/);
  assert.match(`${privacy}\n${messages}`, /does not store IP addresses, user agents, file names, report contents, stack traces, or identifiers/);
  assert.match(privacy, /data-i18n-html="privacy\.localRunHtml"/);
  assert.match(privacy, /href="https:\/\/github\.com\/twidtwid\/crashpad"[^>]*target="_blank"/);
  assert.match(messages, /run this completely locally/);
  assert.match(stats, /data-i18n="stats.title"/);
  assert.match(readme, /they are not network uploads/);
  assert.doesNotMatch(`${privacy}\n${messages}\n${readme}`, /upload endpoint|uploaded reports|upload control/i);
});

test("uses CrashPad as the product name", async () => {
  const [index, privacy, messages, readme] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("privacy.html"),
    readProjectFile("src/i18n/en.js"),
    readProjectFile("README.md"),
  ]);

  assert.match(index, />CrashPad</);
  assert.match(privacy, /Privacy Policy - CrashPad/);
  assert.match(messages, /name: "CrashPad"/);
  assert.match(readme, /^# CrashPad/m);
});

test("project links stay in the sidebar instead of the report action bar", async () => {
  const html = await readProjectFile("index.html");
  const projectLinks = html.match(/<section class="rail-section project-links">[\s\S]*?<\/section>/)?.[0] ?? "";
  const actionBar = html.match(/<div class="actions">[\s\S]*?<\/div>/)?.[0] ?? "";

  assert.match(projectLinks, /href="\/privacy"/);
  assert.match(projectLinks, /href="\/stats"/);
  assert.match(projectLinks, /href="https:\/\/github\.com\/twidtwid\/crashpad"/);
  assert.match(projectLinks, /class="external-link"[^>]*target="_blank"/);
  assert.doesNotMatch(actionBar, /href="\/privacy"/);
  assert.doesNotMatch(actionBar, /href="\/stats"/);
  assert.doesNotMatch(actionBar, /href="https:\/\/github\.com\/twidtwid\/crashpad"/);
});

test("stats page exposes public aggregate analytics", async () => {
  const [statsHtml, statsJs, messages] = await Promise.all([
    readProjectFile("stats.html"),
    readProjectFile("src/stats.js"),
    readProjectFile("src/i18n/en.js"),
  ]);

  assert.match(statsHtml, /id="statsGrid"/);
  assert.match(statsHtml, /id="statsCharts"/);
  assert.match(statsHtml, /class="stats-window-switch"/);
  assert.match(statsHtml, /data-window="1d"/);
  assert.match(statsHtml, /data-window="7d"/);
  assert.match(statsHtml, /data-window="30d"/);
  assert.match(statsHtml, /data-window="90d"/);
  assert.match(statsHtml, /aria-live="polite"/);
  assert.match(statsHtml, /type="module" src="\/src\/stats.js"/);
  assert.match(statsJs, /fetch\("\/api\/stats"\)/);
  assert.match(statsJs, /renderCharts/);
  assert.match(statsJs, /buildDailySeries/);
  assert.match(statsJs, /stats\?\.startedAt/);
  assert.match(statsJs, /renderDailyChart/);
  assert.match(statsJs, /selectedWindow/);
  assert.match(statsJs, /setSelectedWindow/);
  assert.match(statsJs, /renderNotEnoughHistory/);
  assert.match(statsJs, /hasTrendData/);
  assert.match(statsJs, /smoothSegmentPath/);
  assert.match(statsJs, /class="sparkline"/);
  assert.match(statsJs, /class="sparkline-area/);
  assert.match(statsJs, /class="daily-chart"/);
  assert.match(statsJs, /class="daily-chart-card"/);
  assert.match(statsJs, /class="daily-summary-grid"/);
  assert.match(statsJs, /class="chart-legend chart-legend--top"/);
  assert.match(statsJs, /role="img"/);
  assert.doesNotMatch(statsJs, /class="bar-chart"|class="bar-row"|class="bar-track"/);
  assert.match(statsJs, /class="stat-card-label"/);
  assert.match(statsJs, /class="stat-card-value"/);
  assert.match(statsJs, /class="stat-card-sub"/);
  assert.match(statsJs, /class="stat-card-spark"/);
  assert.match(statsJs, /data-event="\$\{escapeAttr\(eventName\)\}"/);
  assert.match(statsJs, /page_view/);
  assert.match(statsJs, /report_analyzed/);
  assert.match(statsJs, /browser_report_analyzed/);
  assert.match(statsJs, /sample_report_analyzed/);
  assert.match(statsJs, /parse_error/);
  assert.match(messages, /stats:\s*{/);
});

test("sidebar and theme controls stay fixed at their natural screen edges", async () => {
  const [html, app, css, messages] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("src/app.js"),
    readProjectFile("src/styles.css"),
    readProjectFile("src/i18n/en.js"),
  ]);
  const rail = html.match(/<aside class="rail"[\s\S]*?<\/aside>/)?.[0] ?? "";
  const topbar = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] ?? "";
  const sidebarControl = html.match(/<div class="sidebar-control"[\s\S]*?<\/div>/)?.[0] ?? "";
  const themeControl = html.match(/<div class="theme-control"[\s\S]*?<\/div>/)?.[0] ?? "";

  assert.doesNotMatch(rail, /id="sidebarToggle"|id="themeToggle"|id="focusToggle"/);
  assert.doesNotMatch(topbar, /id="sidebarToggle"|id="themeToggle"|id="focusToggle"|topbar-controls/);
  assert.match(sidebarControl, /id="sidebarToggle"/);
  assert.match(sidebarControl, /class="sidebar-toggle"/);
  assert.match(sidebarControl, /class="sidebar-icon"/);
  assert.doesNotMatch(sidebarControl, /<span aria-hidden="true"><\/span><span aria-hidden="true"><\/span><span aria-hidden="true"><\/span>/);
  assert.match(themeControl, /role="group"/);
  assert.match(themeControl, /id="themeToggle"/);
  assert.match(themeControl, /class="theme-toggle"/);
  assert.match(themeControl, /class="theme-icon sun-icon"/);
  assert.match(themeControl, /class="theme-icon moon-icon"/);
  assert.doesNotMatch(themeControl, />Dark<|>Light</);
  assert.match(app, /setSidebarHidden/);
  assert.match(app, /setTheme/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /\.sidebar-control\s*{[\s\S]*position:\s*fixed[\s\S]*left:\s*max/);
  assert.match(css, /\.theme-control\s*{[\s\S]*position:\s*fixed[\s\S]*right:\s*max/);
  assert.match(css, /--page-top:\s*18px/);
  assert.match(css, /padding:\s*var\(--page-top\)/);
  assert.match(messages, /themeToggle/);
});

test("topbar action buttons use a compact density", async () => {
  const css = await readProjectFile("src/styles.css");

  assert.match(css, /--top-control-height:\s*26px/);
  assert.match(css, /--top-control-radius:\s*5px/);
  assert.match(css, /\.sidebar-toggle,\s*\.theme-toggle,\s*\.actions \.primary-button,\s*\.actions \.secondary-button/);
  assert.match(css, /\.actions \.primary-button,\s*\.actions \.secondary-button/);
  assert.match(css, /min-height:\s*var\(--top-control-height\)/);
  assert.match(css, /padding:\s*2px 8px/);
  assert.match(css, /font-size:\s*0\.8rem/);
});

test("copy summary action is neutral until the user acts on it", async () => {
  const html = await readProjectFile("index.html");
  const copySummaryButton = html.match(/<button id="copySummary"[\s\S]*?<\/button>/)?.[0] ?? "";

  assert.match(copySummaryButton, /class="secondary-button"/);
  assert.doesNotMatch(copySummaryButton, /class="primary-button"/);
});

test("summary exposes crash story, collection context, and symbolication readiness", async () => {
  const [app, parser, css, messages] = await Promise.all([
    readProjectFile("src/app.js"),
    readProjectFile("src/crashParser.js"),
    readProjectFile("src/styles.css"),
    readProjectFile("src/i18n/en.js"),
  ]);

  assert.match(app, /renderCrashStory/);
  assert.match(app, /renderCollectionContext/);
  assert.match(app, /renderSymbolicationReadiness/);
  assert.match(app, /renderReferenceLink/);
  assert.match(app, /target="_blank"/);
  assert.match(app, /rel="noopener noreferrer"/);
  assert.match(app, /class="reference-link external-link"/);
  assert.match(css, /\.external-link\[target="_blank"\]::after/);
  assert.match(css, /content:\s*"\\2197"/);
  assert.match(parser, /referenceUrl/);
  assert.match(parser, /developer\.apple\.com\/documentation\/xcode\/acquiring-crash-reports-and-diagnostic-logs/);
  assert.match(parser, /developer\.apple\.com\/documentation\/metrickit/);
  assert.match(messages, /crashStory: "Crash Story"/);
  assert.match(messages, /collectionContext: "Collection Context"/);
  assert.match(messages, /symbolicationReadiness: "Symbolication Readiness"/);
});

test("exposes a printable report surface and print action", async () => {
  const [html, app, css, messages] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("src/app.js"),
    readProjectFile("src/styles.css"),
    readProjectFile("src/i18n/en.js"),
  ]);

  assert.match(html, /id="printReport"/);
  assert.match(html, /id="printView"/);
  assert.match(html, /class="print-view"/);
  assert.match(app, /printReport/);
  assert.match(app, /renderPrintReport/);
  assert.match(app, /window\.print\(\)/);
  assert.match(css, /@media print/);
  assert.match(css, /\.print-view/);
  assert.match(messages, /printReport: "Print Report"/);
});

test("browser app does not use persistent storage APIs for chosen reports", async () => {
  const app = await readProjectFile("src/app.js");

  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB|caches\.open/);
  assert.match(app, /clearReport/);
  assert.match(app, /parsed = null/);
  assert.match(app, /analysis = null/);
});

test("server restricts report routes while allowing stats-only POSTs", async () => {
  const server = await readProjectFile("scripts/server.js");

  assert.doesNotMatch(server, /multipart|formData|createWriteStream|appendFile/);
  assert.match(server, /url\.pathname === "\/api\/stats"/);
  assert.match(server, /url\.pathname === "\/api\/stats\/event"/);
  assert.match(server, /method !== "GET" && method !== "HEAD" && method !== "POST"/);
  assert.match(server, /STAT_EVENTS/);
  assert.match(server, /CRASHPAD_STATS_PATH/);
  assert.match(server, /examples\/qlthumbnail\.ips/);
  assert.doesNotMatch(server, /readdir\(root\).*isReportFile/s);
});

test("browser sends only fixed analytics event names", async () => {
  const [app, page, stats] = await Promise.all([
    readProjectFile("src/app.js"),
    readProjectFile("src/i18n/page.js"),
    readProjectFile("src/stats.js"),
  ]);

  assert.match(app, /trackStatEvent\("page_view"\)/);
  assert.match(app, /trackStatEvent\("report_analyzed"\)/);
  assert.match(app, /trackStatEvent\("browser_report_analyzed"\)/);
  assert.match(app, /trackStatEvent\("sample_report_analyzed"\)/);
  assert.match(app, /trackStatEvent\("parse_error"\)/);
  assert.match(app, /trackStatEvent\("summary_copied"\)/);
  assert.match(app, /trackStatEvent\("json_export"\)/);
  assert.match(app, /trackStatEvent\("print_opened"\)/);
  assert.match(app, /body: JSON\.stringify\(\{ event: eventName \}\)/);
  assert.match(page, /trackStatEvent\("page_view"\)/);
  assert.match(stats, /trackStatEvent\("page_view"\)/);
  assert.match(page, /body: JSON\.stringify\(\{ event: eventName \}\)/);
  assert.match(stats, /body: JSON\.stringify\(\{ event: eventName \}\)/);
  assert.doesNotMatch(app, /trackStatEvent\([^)]*fileName|trackStatEvent\([^)]*analysis|trackStatEvent\([^)]*parsed/s);
  assert.doesNotMatch(`${page}\n${stats}`, /trackStatEvent\([^)]*location|trackStatEvent\([^)]*document|trackStatEvent\([^)]*navigator/s);
});
