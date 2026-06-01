import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  UnsupportedFormatError,
  analyzeCrashReport,
  formatFrame,
  parseCrashReport,
  platformName,
} from "../src/crashParser.js";

const readFixture = (name) => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const readExample = (name) => readFile(new URL(`../examples/${name}`, import.meta.url), "utf8");

test("parses Apple IPS crash reports as first-line metadata plus JSON report", async () => {
  const text = await readExample("swift-assertion.ips");
  const parsed = parseCrashReport(text, { fileName: "swift-assertion.ips" });

  assert.equal(parsed.kind, "ips-json");
  assert.equal(parsed.metadata.bug_type, "309");
  assert.equal(parsed.metadata.name, "PosterDemoExtension");
  assert.equal(parsed.report.exception.type, "EXC_BREAKPOINT");
  assert.equal(parsed.report.exception.signal, "SIGTRAP");
  assert.equal(parsed.report.faultingThread, 0);
  assert.equal(parsed.report.threads[0].triggered, true);
});

test("builds a structured analysis for a Swift assertion breakpoint crash", async () => {
  const parsed = parseCrashReport(await readExample("swift-assertion.ips"));
  const analysis = analyzeCrashReport(parsed);

  assert.equal(analysis.identity.process, "PosterDemoExtension");
  assert.equal(analysis.environment.platform, "Mac Catalyst");
  assert.equal(analysis.exception.type, "EXC_BREAKPOINT");
  assert.equal(analysis.exception.signal, "SIGTRAP");
  assert.equal(analysis.exception.category, "Breakpoint / assertion trap");
  assert.equal(analysis.crashedThread.id, 15935995);
  assert.match(analysis.crashedThread.frames[0].symbol, /_assertionFailure/);
  assert.equal(analysis.crashedThread.frames[0].imageName, "libswiftCore.dylib");
  assert.match(analysis.hypothesis, /Swift assertion/i);
  assert.ok(analysis.runtimeSeconds > 19 && analysis.runtimeSeconds < 20);
});

test("builds a structured analysis for an abort with last exception backtrace", async () => {
  const parsed = parseCrashReport(await readExample("language-exception.ips"));
  const analysis = analyzeCrashReport(parsed);

  assert.equal(analysis.identity.process, "ClipboardDemo");
  assert.equal(analysis.environment.platform, "macOS");
  assert.equal(analysis.exception.type, "EXC_CRASH");
  assert.equal(analysis.exception.signal, "SIGABRT");
  assert.equal(analysis.exception.category, "Abort / language exception");
  assert.ok(analysis.diagnostics.some((item) => item.message === "abort() called"));
  assert.match(analysis.lastException.frames[2].symbol, /NSURL/);
  assert.match(analysis.hypothesis, /Objective-C exception/i);
  assert.match(analysis.rootCause.headline, /uncaught language exception/i);
  assert.match(analysis.rootCause.summary, /Last Exception Backtrace/i);
  assert.ok(analysis.rootCause.signals.some((signal) => signal.label === "Last Exception Backtrace"));
  assert.ok(analysis.rootCause.signals.some((signal) => /mechanism/i.test(signal.meaning)));
});

test("parses and analyzes every IPS crash report currently in the folder", async () => {
  const files = (await readdir(new URL("../examples/", import.meta.url))).filter((name) => name.endsWith(".ips"));

  assert.ok(files.length >= 5);

  for (const file of files) {
    const parsed = parseCrashReport(await readExample(file), { fileName: file });
    const analysis = analyzeCrashReport(parsed);

    assert.equal(parsed.kind, "ips-json", file);
    assert.equal(parsed.metadata.bug_type, "309", file);
    assert.ok(analysis.identity.process, file);
    assert.ok(analysis.exception.category, file);
    assert.ok(Array.isArray(analysis.recommendations), file);
  }
});

test("demystifies Swift and framework traps with the documented breakpoint pattern", async () => {
  const swiftTrap = analyzeCrashReport(parseCrashReport(await readExample("swift-assertion.ips")));
  const sandboxTrap = analyzeCrashReport(parseCrashReport(await readExample("framework-trap.ips")));

  assert.match(swiftTrap.rootCause.headline, /Swift runtime/i);
  assert.ok(swiftTrap.rootCause.signals.some((signal) => /trace trap/i.test(signal.meaning)));
  assert.ok(swiftTrap.rootCause.signals.some((signal) => /_assertionFailure/.test(signal.value)));

  assert.match(sandboxTrap.rootCause.headline, /framework trap/i);
  assert.ok(sandboxTrap.rootCause.signals.some((signal) => /unrecoverable/i.test(signal.meaning)));
});

test("demystifies simulated user fault reports using exception notes", async () => {
  const analysis = analyzeCrashReport(parseCrashReport(await readExample("simulated-guard.ips")));

  assert.equal(analysis.exception.notes.includes("SIMULATED"), true);
  assert.match(analysis.rootCause.headline, /not a normal app crash/i);
  assert.ok(analysis.rootCause.signals.some((signal) => signal.label === "Exception Note"));
  assert.ok(analysis.rootCause.signals.some((signal) => /WEBKIT/.test(signal.value)));
});

test("demystifies memory access reports with subtype, address, VM region, and registers", async () => {
  const analysis = analyzeCrashReport(parseCrashReport(await readExample("memory-access.ips")));

  assert.match(analysis.rootCause.headline, /invalid memory access/i);
  assert.match(analysis.rootCause.summary, /0x0000000000000028/);
  assert.ok(analysis.rootCause.signals.some((signal) => signal.label === "VM Region Info" && /not in any region/.test(signal.value)));
  assert.equal(analysis.rootCause.signals.filter((signal) => signal.label === "VM Region Info").length, 1);
  assert.ok(analysis.rootCause.signals.some((signal) => signal.label === "Thread State" && /pc/.test(signal.value)));
});

test("formats frame addresses from image base plus image offset using documented IPS mapping", async () => {
  const parsed = parseCrashReport(await readExample("swift-assertion.ips"));
  const frame = parsed.report.threads[0].frames[0];
  const formatted = formatFrame(frame, parsed.report.usedImages);

  assert.equal(formatted.address, "0x0000000100000cc8");
  assert.equal(formatted.imageName, "libswiftCore.dylib");
  assert.equal(formatted.symbol, "_assertionFailure(_:_:file:line:flags:)");
  assert.equal(formatted.symbolLocation, 172);
});

test("rejects non-crash IPS logs when bug_type is not 309", () => {
  const stackshot = `{"bug_type":"288","name":"Sample"}\n{"threads":[]}`;

  assert.throws(() => parseCrashReport(stackshot), /not an Apple crash report/);
});

test("rejects binary alias/bookmark files as unsupported input", () => {
  assert.throws(
    () => parseCrashReport("book\u0000\u0000\u0000\u0000mark\u0000\u0000\u0000\u0000"),
    UnsupportedFormatError,
  );
});

test("parses legacy text crash report headers and backtraces", () => {
  const text = `Incident Identifier: ABC-123
CrashReporter Key:   redacted
Hardware Model:      Mac17,7
Process:             TinyApp [42]
Path:                /Applications/TinyApp.app/Contents/MacOS/TinyApp
Identifier:          com.example.TinyApp
Version:             3.1 (99)
Code Type:           ARM-64 (Native)
Parent Process:      launchd [1]

Date/Time:           2026-05-31 12:00:00.0000 -0700
Launch Time:         2026-05-31 11:59:50.0000 -0700
OS Version:          macOS 26.5 (25F71)

Exception Type:  EXC_BAD_ACCESS (SIGSEGV)
Exception Subtype: KERN_INVALID_ADDRESS at 0x0000000000000000
Triggered by Thread:  2

Thread 2 Crashed:
0   TinyApp                         0x0000000100001234 TinyApp.doThing() + 12
1   libsystem_pthread.dylib         0x0000000190000000 start_wqthread + 8

Binary Images:
0x100000000 - 0x10000ffff +com.example.TinyApp (3.1 - 99) <ABCDEF12-3456-7890-ABCD-EF1234567890> /Applications/TinyApp.app/Contents/MacOS/TinyApp
`;

  const analysis = analyzeCrashReport(parseCrashReport(text, { fileName: "TinyApp.crash" }));

  assert.equal(analysis.kind, "legacy-text");
  assert.equal(analysis.identity.process, "TinyApp");
  assert.equal(analysis.exception.type, "EXC_BAD_ACCESS");
  assert.equal(analysis.exception.signal, "SIGSEGV");
  assert.equal(analysis.exception.category, "Memory access");
  assert.equal(analysis.crashedThread.index, 2);
  assert.equal(analysis.crashedThread.frames[0].symbol, "TinyApp.doThing()");
});

test("maps documented Apple platform numbers", () => {
  assert.equal(platformName(1), "macOS");
  assert.equal(platformName(2), "iOS");
  assert.equal(platformName(6), "Mac Catalyst");
  assert.equal(platformName(9), "watchOS Simulator");
  assert.equal(platformName(999), "Unknown platform 999");
});
