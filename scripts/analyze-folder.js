import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeCrashReport, parseCrashReport } from "../src/crashParser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = path.join(root, "reports");
const files = await reportFiles();
const rows = [];

await mkdir(reportsDir, { recursive: true });

for (const file of files) {
  try {
    const parsed = parseCrashReport(await readFile(path.join(root, file), "utf8"), { fileName: file });
    const analysis = analyzeCrashReport(parsed);
    const output = withoutRaw(analysis);
    await writeFile(path.join(reportsDir, `${analysisStem(file)}.analysis.json`), `${JSON.stringify(output, null, 2)}\n`);
    rows.push({ file, analysis: output });
  } catch (error) {
    rows.push({ file, error });
  }
}

await writeFile(path.join(reportsDir, "analysis-summary.md"), renderMarkdown(rows));

console.log(`Analyzed ${rows.length} report(s).`);
console.log(`Wrote ${path.join(reportsDir, "analysis-summary.md")}`);

async function reportFiles() {
  const files = (await readdir(root)).filter(isReportFile).sort();
  try {
    const examples = (await readdir(path.join(root, "examples")))
      .filter(isReportFile)
      .sort()
      .map((name) => path.join("examples", name));
    return [...files, ...examples];
  } catch (error) {
    if (error.code === "ENOENT") return files;
    throw error;
  }
}

function renderMarkdown(items) {
  const generatedAt = new Date().toISOString();
  const successful = items.filter((item) => item.analysis);
  const failed = items.filter((item) => item.error);

  return `# Crash Report Analysis Summary

Generated: ${generatedAt}

Input folder: \`${root}\`

Reports parsed: ${successful.length}
Reports failed: ${failed.length}

${successful.map(renderReportSection).join("\n\n")}
${failed.length ? `\n\n## Parse Failures\n\n${failed.map((item) => `- \`${item.file}\`: ${item.error.message}`).join("\n")}\n` : ""}
`;
}

function renderReportSection({ file, analysis }) {
  const topFrame = analysis.crashedThread.frames[0];
  const lastExceptionFrame = analysis.lastException.frames.find((frame) => !/^(__exceptionPreprocess|objc_exception_throw|abort|pthread_kill|__pthread_kill|start)$/.test(frame.symbol));
  const diagnostics = analysis.diagnostics.length
    ? analysis.diagnostics.map((item) => `  - ${item.source}: ${oneLine(item.message)}`).join("\n")
    : "  - None present";

  return `## ${analysis.identity.process || file}

- File: \`${file}\`
- Incident: \`${analysis.identity.incident || "not present"}\`
- Bundle: \`${analysis.identity.bundleId || "not present"}\`
- Version: \`${analysis.identity.version || "not present"}\`
- Platform: ${analysis.environment.platform || "unknown"} on ${analysis.environment.osVersion || "unknown OS"} (${analysis.environment.model || "unknown hardware"})
- Exception: ${analysis.exception.type || "unknown"}${analysis.exception.signal ? ` (${analysis.exception.signal})` : ""} - ${analysis.exception.category}
- Termination: ${analysis.exception.terminationNamespace || "unknown"}${analysis.exception.terminationCode !== null ? ` code ${analysis.exception.terminationCode}` : ""}${analysis.exception.terminationIndicator ? `, ${analysis.exception.terminationIndicator}` : ""}
- Runtime: ${typeof analysis.runtimeSeconds === "number" ? `${analysis.runtimeSeconds.toFixed(2)} seconds` : "unknown"}
- Crashed thread: ${analysis.crashedThread.index}${analysis.crashedThread.queue ? `, ${analysis.crashedThread.queue}` : ""}
- Top crashed frame: ${topFrame ? `\`${topFrame.symbol}\` in \`${topFrame.imageName}\` at \`${topFrame.address || "unknown address"}\`` : "not present"}
- Last exception clue: ${lastExceptionFrame ? `\`${lastExceptionFrame.symbol}\` in \`${lastExceptionFrame.imageName}\`` : "not present"}
- Root cause guide: ${analysis.rootCause?.headline || "not available"} (${analysis.rootCause?.confidence || "unknown"} confidence)
- Root cause summary: ${analysis.rootCause?.summary || "not available"}
- Hypothesis: ${analysis.hypothesis}

Root cause signals:
${(analysis.rootCause?.signals ?? []).map((signal) => `- ${signal.label}: ${oneLine(signal.value)} - ${oneLine(signal.meaning)}`).join("\n") || "- None present"}

Diagnostics:
${diagnostics}

Recommended next actions:
${analysis.recommendations.map((item) => `- ${item}`).join("\n")}
`;
}

function oneLine(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function withoutRaw(analysis) {
  const { raw, ...rest } = analysis;
  return rest;
}

function isReportFile(name) {
  return /\.(ips|crash)$/i.test(name);
}

function analysisStem(file) {
  return file.replace(/[\\/]/g, "__").replace(/\.(ips|crash)$/i, "");
}
