import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exampleRoot = path.join(root, "examples");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const publicSamples = [
  { name: "examples/qlthumbnail.ips", filePath: path.join(exampleRoot, "qlthumbnail.ips") },
];

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
    if (method !== "GET" && method !== "HEAD") return methodNotAllowed(response);

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
  return pathname;
}

function sendJson(response, value) {
  response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function methodNotAllowed(response) {
  response.writeHead(405, {
    "Allow": "GET, HEAD",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end("Method not allowed");
}
