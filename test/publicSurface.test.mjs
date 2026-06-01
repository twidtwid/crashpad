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

test("browser app does not use persistent storage APIs for uploaded reports", async () => {
  const app = await readProjectFile("src/app.js");

  assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB|caches\.open/);
  assert.match(app, /clearReport/);
  assert.match(app, /parsed = null/);
  assert.match(app, /analysis = null/);
});

test("server has no upload endpoint and restricts samples to examples", async () => {
  const server = await readProjectFile("scripts/server.js");

  assert.doesNotMatch(server, /multipart|formData|createWriteStream|appendFile|writeFile/);
  assert.match(server, /method !== "GET"/);
  assert.match(server, /examples\/qlthumbnail\.ips/);
  assert.doesNotMatch(server, /readdir\(root\).*isReportFile/s);
});
