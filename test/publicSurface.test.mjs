import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

test("commits exactly one public example for QLThumbnail", async () => {
  const examples = (await readdir(new URL("../examples/", import.meta.url))).filter((name) => name.endsWith(".ips"));

  assert.deepEqual(examples, ["qlthumbnail.ips"]);
});

test("page exposes privacy policy, repository link, and clear-report control", async () => {
  const html = await readProjectFile("index.html");

  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="https:\/\/github\.com\/twidtwid\/crashreporter"/);
  assert.match(html, /id="clearReport"/);
});

test("privacy copy distinguishes local file input from server upload routes", async () => {
  const [index, privacy, messages, readme] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("privacy.html"),
    readProjectFile("src/i18n/en.js"),
    readProjectFile("README.md"),
  ]);

  assert.match(index, />Open \.ips \/ \.crash</);
  assert.match(privacy, /local browser inputs, not a network upload/);
  assert.match(messages, /has no route that receives crash report files/);
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
  assert.match(projectLinks, /href="https:\/\/github\.com\/twidtwid\/crashreporter"/);
  assert.doesNotMatch(actionBar, /href="\/privacy"/);
  assert.doesNotMatch(actionBar, /href="https:\/\/github\.com\/twidtwid\/crashreporter"/);
});

test("topbar exposes persistent focus and color mode controls", async () => {
  const [html, app, css, messages] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("src/app.js"),
    readProjectFile("src/styles.css"),
    readProjectFile("src/i18n/en.js"),
  ]);
  const rail = html.match(/<aside class="rail"[\s\S]*?<\/aside>/)?.[0] ?? "";
  const topbar = html.match(/<header class="topbar">[\s\S]*?<\/header>/)?.[0] ?? "";

  assert.doesNotMatch(rail, /id="focusToggle"/);
  assert.match(topbar, /id="focusToggle"/);
  assert.match(topbar, /id="themeToggle"/);
  assert.match(topbar, /class="utility-buttons" role="group"/);
  assert.match(topbar, /class="topbar-controls"/);
  assert.match(app, /setFocusMode/);
  assert.match(app, /setTheme/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(messages, /themeToggle/);
});

test("topbar action buttons use a compact density", async () => {
  const css = await readProjectFile("src/styles.css");

  assert.match(css, /\.actions \.primary-button,\s*\.actions \.secondary-button/);
  assert.match(css, /min-height:\s*30px/);
  assert.match(css, /padding:\s*4px 10px/);
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

test("server rejects write methods and restricts samples to examples", async () => {
  const server = await readProjectFile("scripts/server.js");

  assert.doesNotMatch(server, /multipart|formData|createWriteStream|appendFile|writeFile/);
  assert.match(server, /method !== "GET"/);
  assert.match(server, /examples\/qlthumbnail\.ips/);
  assert.doesNotMatch(server, /readdir\(root\).*isReportFile/s);
});
