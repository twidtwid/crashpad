import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");

function tagById(html, id) {
  const match = new RegExp(`<[^>]+id="${id}"[^>]*>`, "s").exec(html);
  assert.ok(match, `Expected #${id} to exist`);
  return match[0];
}

function tagsByClass(html, className) {
  return [...html.matchAll(new RegExp(`<[^>]+class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "g"))].map((match) => match[0]);
}

test("report UI exposes accessible status, upload help, and tab semantics", async () => {
  const html = await readProjectFile("index.html");

  const status = tagById(html, "statusBox");
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
  assert.match(status, /aria-atomic="true"/);

  const reportView = tagById(html, "reportView");
  assert.match(reportView, /role="tabpanel"/);
  assert.match(reportView, /aria-live="polite"/);
  assert.match(reportView, /aria-busy="false"/);

  const tabs = tagsByClass(html, "tab");
  assert.equal(tabs.length, 4);
  for (const tab of tabs) {
    assert.match(tab, /role="tab"/);
    assert.match(tab, /aria-controls="reportView"/);
    assert.match(tab, /aria-selected="(?:true|false)"/);
    assert.match(tab, /id="tab-[a-z]+"/);
  }

  assert.match(html, /role="tablist"/);
  assert.match(html, /id="privacyNote"/);
  assert.match(html, /aria-describedby="privacyNote"/);
  assert.match(html, /aria-hidden="true"/);
});

test("styles provide explicit keyboard focus affordances", async () => {
  const css = await readProjectFile("src/styles.css");
  const app = await readProjectFile("src/app.js");

  assert.match(css, /--focus:/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(app, /class="table-wrap" tabindex="0" role="region"/);
});

test("static pages and dynamic app strings are prepared for translation", async () => {
  const [index, privacy, app, en, dom, page] = await Promise.all([
    readProjectFile("index.html"),
    readProjectFile("privacy.html"),
    readProjectFile("src/app.js"),
    readProjectFile("src/i18n/en.js"),
    readProjectFile("src/i18n/dom.js"),
    readProjectFile("src/i18n/page.js"),
  ]);

  assert.match(en, /export const messages/);
  assert.match(en, /export function t/);
  assert.match(en, /app:\s*{/);
  assert.match(dom, /export function applyStaticTranslations/);
  assert.match(page, /applyStaticTranslations\(\)/);

  assert.match(index, /data-i18n="app.name"/);
  assert.match(index, /data-i18n-placeholder="filters.searchPlaceholder"/);
  assert.match(index, /data-i18n-aria-label="actions.hideSidebar"/);
  assert.match(index, /data-i18n-aria-label="actions.switchToDarkMode"/);
  assert.match(privacy, /data-i18n="privacy.title"/);
  assert.match(privacy, /type="module" src="\/src\/i18n\/page.js"/);

  assert.match(app, /from "\.\/i18n\/en\.js"/);
  assert.match(app, /from "\.\/i18n\/dom\.js"/);
  assert.match(app, /\bt\("status\.waiting"\)/);
  assert.match(app, /\bt\("report\.summary\.environment"\)/);
});
