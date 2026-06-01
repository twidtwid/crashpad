import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("stats API records only public aggregate counters", async (t) => {
  const { baseUrl, statsPath } = await startCrashPadServer(t);

  const initialResponse = await fetch(`${baseUrl}/api/stats`);
  assert.equal(initialResponse.status, 200);
  const initial = await initialResponse.json();
  assert.equal(initial.totals.page_view, 0);
  assert.equal(initial.totals.report_analyzed, 0);

  const pageView = await postStat(baseUrl, {
    event: "page_view",
    fileName: "SecretCustomerCrash.ips",
    contents: "do not persist this crash text",
    userAgent: "do not persist this user agent",
  });
  assert.equal(pageView.status, 204);

  assert.equal((await postStat(baseUrl, { event: "browser_report_analyzed" })).status, 204);
  assert.equal((await postStat(baseUrl, { event: "report_analyzed" })).status, 204);
  assert.equal((await postStat(baseUrl, { event: "parse_error" })).status, 204);

  const rejected = await postStat(baseUrl, { event: "file_name:SecretCustomerCrash.ips" });
  assert.equal(rejected.status, 400);

  const statsResponse = await fetch(`${baseUrl}/api/stats`);
  assert.equal(statsResponse.status, 200);
  const stats = await statsResponse.json();
  assert.deepEqual(
    {
      page_view: stats.totals.page_view,
      browser_report_analyzed: stats.totals.browser_report_analyzed,
      report_analyzed: stats.totals.report_analyzed,
      parse_error: stats.totals.parse_error,
    },
    {
      page_view: 1,
      browser_report_analyzed: 1,
      report_analyzed: 1,
      parse_error: 1,
    },
  );
  assert.match(stats.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(stats.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(stats.generatedAt, /^\d{4}-\d{2}-\d{2}T/);

  const rawStatsFile = await readFile(statsPath, "utf8");
  assert.doesNotMatch(rawStatsFile, /SecretCustomerCrash|do not persist|userAgent|contents/i);
});

async function postStat(baseUrl, body) {
  return fetch(`${baseUrl}/api/stats/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function startCrashPadServer(t) {
  const port = await freePort();
  const statsDir = await mkdtemp(path.join(tmpdir(), "crashpad-stats-"));
  const statsPath = path.join(statsDir, "stats.json");
  const child = spawn(process.execPath, ["scripts/server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      CRASHPAD_STATS_PATH: statsPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => child.kill());

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child, () => output);
  return { baseUrl, statsPath };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(baseUrl, child, output) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Server exited early: ${output()}`);
    try {
      const response = await fetch(`${baseUrl}/api/samples`);
      if (response.ok) return;
    } catch {
      await delay(50);
    }
  }
  throw new Error(`Server did not start: ${output()}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
