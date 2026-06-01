import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = path.join(root, "examples");
const port = Number(process.env.PORT || 4173);

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
    const url = new URL(request.url, `http://${request.headers.host}`);
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
}).listen(port, "127.0.0.1", () => {
  console.log(`Crash Reporter running at http://127.0.0.1:${port}`);
});

async function listSamples() {
  const rows = [];
  for (const sample of await sampleFiles()) rows.push(await sampleMetadata(sample));
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

async function sampleFiles() {
  const files = [];

  for (const name of (await readdir(root)).filter(isReportFile).sort()) {
    files.push({ name, filePath: path.join(root, name) });
  }

  try {
    for (const name of (await readdir(exampleRoot)).filter(isReportFile).sort()) {
      files.push({ name: `examples/${name}`, filePath: path.join(exampleRoot, name) });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return files;
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
  if (!isSafeReportName(name)) return "";

  if (name.startsWith("examples/")) {
    const exampleName = name.slice("examples/".length);
    if (path.basename(exampleName) !== exampleName) return "";
    return path.join(exampleRoot, exampleName);
  }

  if (path.basename(name) !== name) return "";
  return path.join(root, name);
}

function routeStaticPath(pathname) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const candidate = path.resolve(root, `.${decodeURIComponent(normalized)}`);
  if (!candidate.startsWith(root + path.sep)) {
    const error = new Error("Path escapes root");
    error.code = "ENOENT";
    throw error;
  }

  const allowed = candidate === path.join(root, "index.html")
    || candidate.startsWith(path.join(root, "src") + path.sep);
  if (!allowed) {
    const error = new Error("Static path not allowed");
    error.code = "ENOENT";
    throw error;
  }

  return candidate;
}

function isReportFile(name) {
  return /\.(ips|crash)$/i.test(name);
}

function isSafeReportName(name) {
  return Boolean(name)
    && !name.includes("..")
    && isReportFile(name)
    && (path.basename(name) === name || name.startsWith("examples/"));
}

function sendJson(response, value) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
