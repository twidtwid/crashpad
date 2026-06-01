import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = path.join(root, "examples");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const statsPath = path.resolve(process.env.CRASHPAD_STATS_PATH || path.join(root, ".data", "stats.json"));
const publicSamples = [
  { name: "examples/qlthumbnail.ips", filePath: path.join(exampleRoot, "qlthumbnail.ips") },
];
const STAT_EVENTS = [
  "page_view",
  "report_analyzed",
  "browser_report_analyzed",
  "sample_report_analyzed",
  "parse_error",
  "summary_copied",
  "json_export",
  "print_opened",
];
const statEvents = new Set(STAT_EVENTS);
let statsQueue = Promise.resolve();

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ips", "application/json; charset=utf-8"],
  [".crash", "text/plain; charset=utf-8"],
]);

createServer(async (request, response) => {
  try {
    const method = request.method ?? "GET";
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (method !== "GET" && method !== "HEAD" && method !== "POST") return methodNotAllowed(response, "GET, HEAD, POST");
    if (url.pathname === "/api/stats/event") {
      if (method !== "POST") return methodNotAllowed(response, "POST");
      return recordStatEvent(request, response);
    }
    if (method === "POST") return methodNotAllowed(response);

    if (url.pathname === "/api/stats") return sendJson(response, await readPublicStats());
    if (url.pathname === "/api/samples") return sendJson(response, await listSamples());
    if (url.pathname === "/api/sample") return sendSample(response, url.searchParams.get("file") ?? "");

    const filePath = routeStaticPath(url.pathname);
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream" });
    response.end(body);
  } catch (error) {
    const status = error.code === "ENOENT" ? 404 : 500;
    response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(status === 404 ? "Not found" : error.stack);
  }
}).listen(port, host, () => {
  console.log(`CrashPad running at http://${host}:${port}`);
});

async function listSamples() {
  const rows = [];
  for (const sample of publicSamples) rows.push(await sampleMetadata(sample));
  return rows;
}

async function sendSample(response, fileName) {
  const filePath = samplePath(fileName);
  if (!filePath) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid sample file");
    return;
  }

  const body = await readFile(filePath);
  response.writeHead(200, { "Content-Type": contentTypes.get(path.extname(filePath)) ?? "text/plain; charset=utf-8" });
  response.end(body);
}

async function sampleMetadata(sample) {
  const info = await stat(sample.filePath);
  return {
    name: sample.name,
    size: info.size,
    modified: info.mtime.toISOString().slice(0, 19).replace("T", " "),
  };
}

function samplePath(name) {
  const sample = publicSamples.find((item) => item.name === name);
  return sample?.filePath ?? "";
}

async function recordStatEvent(request, response) {
  let body;
  try {
    body = await readRequestBody(request, 1024);
  } catch {
    response.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Stats event is too large");
    return;
  }

  let payload;
  try {
    payload = JSON.parse(body || "{}");
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Invalid stats event");
    return;
  }

  const eventName = typeof payload.event === "string" ? payload.event : "";
  if (!statEvents.has(eventName)) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unknown stats event");
    return;
  }

  await incrementStat(eventName);
  response.writeHead(204, { "Cache-Control": "no-store" });
  response.end();
}

async function readRequestBody(request, maxBytes) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > maxBytes) {
      throw new Error("Request too large");
    }
  }
  return body;
}

async function readPublicStats() {
  return publicStats(await loadStats());
}

async function incrementStat(eventName) {
  const work = statsQueue.then(async () => {
    const stats = await loadStats();
    const day = todayKey();
    stats.totals[eventName] = (stats.totals[eventName] ?? 0) + 1;
    stats.daily[day] = stats.daily[day] ?? emptyTotals();
    stats.daily[day][eventName] = (stats.daily[day][eventName] ?? 0) + 1;
    stats.updatedAt = new Date().toISOString();
    await mkdir(path.dirname(statsPath), { recursive: true });
    await writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`);
  });
  statsQueue = work.catch(() => {});
  return work;
}

async function loadStats() {
  try {
    return normalizeStats(JSON.parse(await readFile(statsPath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return defaultStats();
    throw error;
  }
}

function normalizeStats(value = {}) {
  const stats = {
    startedAt: typeof value.startedAt === "string" ? value.startedAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    totals: {},
    daily: normalizeDaily(value.daily),
  };
  for (const eventName of STAT_EVENTS) {
    const count = Number(value.totals?.[eventName] ?? 0);
    stats.totals[eventName] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }
  return stats;
}

function defaultStats() {
  return normalizeStats({ startedAt: new Date().toISOString(), updatedAt: "" });
}

function publicStats(stats) {
  return {
    generatedAt: new Date().toISOString(),
    startedAt: stats.startedAt,
    updatedAt: stats.updatedAt || stats.startedAt,
    totals: stats.totals,
    daily: dailyRows(stats.daily),
  };
}

function normalizeDaily(value = {}) {
  const entries = Array.isArray(value)
    ? value.map((row) => [row.date, row.totals])
    : Object.entries(value);
  const daily = {};
  for (const [date, totals] of entries) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) continue;
    daily[date] = normalizeTotals(totals);
  }
  return daily;
}

function normalizeTotals(value = {}) {
  const totals = emptyTotals();
  for (const eventName of STAT_EVENTS) {
    const count = Number(value?.[eventName] ?? 0);
    totals[eventName] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }
  return totals;
}

function emptyTotals() {
  return Object.fromEntries(STAT_EVENTS.map((eventName) => [eventName, 0]));
}

function dailyRows(daily = {}) {
  return Object.entries(daily)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, totals]) => ({ date, totals }));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function routeStaticPath(pathname) {
  const normalized = routeAlias(pathname);
  const candidate = path.resolve(root, `.${decodeURIComponent(normalized)}`);
  if (!candidate.startsWith(root + path.sep)) {
    const error = new Error("Path escapes root");
    error.code = "ENOENT";
    throw error;
  }

  const allowed = candidate === path.join(root, "index.html")
    || candidate === path.join(root, "privacy.html")
    || candidate === path.join(root, "stats.html")
    || candidate.startsWith(path.join(root, "src") + path.sep);
  if (!allowed) {
    const error = new Error("Static path not allowed");
    error.code = "ENOENT";
    throw error;
  }

  return candidate;
}

function routeAlias(pathname) {
  if (pathname === "/") return "/index.html";
  if (pathname === "/privacy") return "/privacy.html";
  if (pathname === "/stats") return "/stats.html";
  return pathname;
}

function sendJson(response, value) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function methodNotAllowed(response, allow = "GET, HEAD") {
  response.writeHead(405, {
    "Allow": allow,
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end("Method not allowed");
}
