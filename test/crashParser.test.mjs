import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  UnsupportedFormatError,
  analyzeCrashReport,
  formatFrame,
  parseCrashReport,
  platformName,
} from "../src/crashParser.js";

const readExample = (name) => readFile(new URL(`../examples/${name}`, import.meta.url), "utf8");

test("parses Apple IPS crash reports as first-line metadata plus JSON report", async () => {
  const parsed = parseCrashReport(await readExample("qlthumbnail.ips"), { fileName: "qlthumbnail.ips" });

  assert.equal(parsed.kind, "ips-json");
  assert.equal(parsed.metadata.bug_type, "309");
  assert.equal(parsed.metadata.name, "QLThumbnail");
  assert.equal(parsed.report.exception.type, "EXC_BREAKPOINT");
  assert.equal(parsed.report.exception.signal, "SIGTRAP");
  assert.equal(parsed.report.faultingThread, 0);
  assert.equal(parsed.report.threads[0].triggered, true);
});

test("builds a structured analysis for a Swift assertion breakpoint crash", () => {
  const analysis = analyzeCrashReport(parseCrashReport(swiftAssertionIps()));

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

test("builds a structured analysis for an abort with last exception backtrace", () => {
  const analysis = analyzeCrashReport(parseCrashReport(languageExceptionIps()));

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

test("parses and analyzes the public QLThumbnail example", async () => {
  const parsed = parseCrashReport(await readExample("qlthumbnail.ips"), { fileName: "qlthumbnail.ips" });
  const analysis = analyzeCrashReport(parsed);

  assert.equal(parsed.kind, "ips-json");
  assert.equal(parsed.metadata.bug_type, "309");
  assert.equal(analysis.identity.process, "QLThumbnail");
  assert.equal(analysis.exception.category, "Breakpoint / assertion trap");
  assert.match(analysis.rootCause.headline, /framework trap/i);
});

test("demystifies Swift and framework traps with the documented breakpoint pattern", async () => {
  const swiftTrap = analyzeCrashReport(parseCrashReport(swiftAssertionIps()));
  const sandboxTrap = analyzeCrashReport(parseCrashReport(await readExample("qlthumbnail.ips")));

  assert.match(swiftTrap.rootCause.headline, /Swift runtime/i);
  assert.ok(swiftTrap.rootCause.signals.some((signal) => /trace trap/i.test(signal.meaning)));
  assert.ok(swiftTrap.rootCause.signals.some((signal) => /_assertionFailure/.test(signal.value)));

  assert.match(sandboxTrap.rootCause.headline, /framework trap/i);
  assert.ok(sandboxTrap.rootCause.signals.some((signal) => /unrecoverable/i.test(signal.meaning)));
});

test("demystifies simulated user fault reports using exception notes", () => {
  const analysis = analyzeCrashReport(parseCrashReport(simulatedGuardIps()));

  assert.equal(analysis.exception.notes.includes("SIMULATED"), true);
  assert.match(analysis.rootCause.headline, /not a normal app crash/i);
  assert.ok(analysis.rootCause.signals.some((signal) => signal.label === "Exception Note"));
  assert.ok(analysis.rootCause.signals.some((signal) => /WEBKIT/.test(signal.value)));
});

test("demystifies memory access reports with subtype, address, VM region, and registers", () => {
  const analysis = analyzeCrashReport(parseCrashReport(memoryAccessIps()));

  assert.match(analysis.rootCause.headline, /invalid memory access/i);
  assert.match(analysis.rootCause.summary, /0x0000000000000028/);
  assert.ok(analysis.rootCause.signals.some((signal) => signal.label === "VM Region Info" && /not in any region/.test(signal.value)));
  assert.equal(analysis.rootCause.signals.filter((signal) => signal.label === "VM Region Info").length, 1);
  assert.ok(analysis.rootCause.signals.some((signal) => signal.label === "Thread State" && /pc/.test(signal.value)));
  assert.equal(analysis.symbolication.missingImageUuids[0].uuid, "DEMO-MemoryAccessDemo");
  assert.match(analysis.symbolication.advice, /matching dSYM/i);
  assert.ok(analysis.crashStory.checks.some((check) => check.label === "Faulting address" && /low address/i.test(check.detail)));
});

test("classifies watchdog and OS terminations as collection-sensitive crash reports", () => {
  const analysis = analyzeCrashReport(parseCrashReport(watchdogIps()));

  assert.equal(analysis.exception.category, "Watchdog termination");
  assert.equal(analysis.osTermination.kind, "watchdog");
  assert.match(analysis.osTermination.summary, /20 seconds/i);
  assert.match(analysis.rootCause.headline, /watchdog/i);
  assert.ok(analysis.rootCause.signals.some((signal) => signal.label === "OS termination"));
  assert.ok(analysis.recommendations.some((item) => /outside the debugger/i.test(item)));
  assert.equal(analysis.collectionContext.primarySource, "IPS crash report");
  assert.ok(analysis.collectionContext.relatedSources.some((source) => /not always appear in Xcode Organizer/i.test(source.detail)));
  assert.ok(analysis.crashStory.checks.some((check) => check.label === "Termination reason" && /watchdog/i.test(check.detail)));
});

test("formats frame addresses from image base plus image offset using documented IPS mapping", () => {
  const parsed = parseCrashReport(swiftAssertionIps());
  const frame = parsed.report.threads[0].frames[0];
  const formatted = formatFrame(frame, parsed.report.usedImages);

  assert.equal(formatted.address, "0x0000000100000cc8");
  assert.equal(formatted.imageName, "libswiftCore.dylib");
  assert.equal(formatted.symbol, "_assertionFailure(_:_:file:line:flags:)");
  assert.equal(formatted.symbolLocation, 172);
});

test("rejects non-crash IPS logs with a helpful log-type explanation", () => {
  const stackshot = `{"bug_type":"288","name":"Sample"}\n{"threads":[]}`;

  assert.throws(() => parseCrashReport(stackshot), /stackshot/i);
  assert.throws(() => parseCrashReport(stackshot), /CrashPad currently analyzes bug_type 309/i);
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

function swiftAssertionIps() {
  return ips(
    { name: "PosterDemoExtension", bundleID: "com.example.PosterDemoExtension", platform: 6, incident_id: "DEMO-SWIFT" },
    baseReport({
      procName: "PosterDemoExtension",
      bundleId: "com.example.PosterDemoExtension",
      procPath: "/Applications/PosterDemo.app/Contents/PlugIns/PosterDemoExtension.appex/Contents/MacOS/PosterDemoExtension",
      procLaunch: "2026-05-30 20:50:02.0000 -0700",
      captureTime: "2026-05-30 20:50:21.9000 -0700",
      exception: { codes: "0x0000000000000001, 0x0000000100000cc8", rawCodes: [1, 4294970568], type: "EXC_BREAKPOINT", signal: "SIGTRAP" },
      termination: { flags: 0, code: 5, namespace: "SIGNAL", indicator: "Trace/BPT trap: 5", byProc: "exc handler", byPid: 12796 },
      faultingThread: 0,
      threads: [{
        id: 15935995,
        triggered: true,
        queue: "com.apple.main-thread",
        frames: [
          { imageIndex: 0, imageOffset: 3272, symbol: "_assertionFailure(_:_:file:line:flags:)", symbolLocation: 172 },
          { imageIndex: 1, imageOffset: 16384, symbol: "specialized EnvironmentValues.subscript.getter", symbolLocation: 88 },
        ],
        threadState: threadState(4294970568, "(Breakpoint) brk 1"),
      }],
      usedImages: [
        image("libswiftCore.dylib", "/usr/lib/swift/libswiftCore.dylib", 4294967296),
        image("SwiftUICore", "/System/Library/PrivateFrameworks/SwiftUICore.framework/Versions/A/SwiftUICore", 4378853376),
      ],
    }),
  );
}

function languageExceptionIps() {
  return ips(
    { name: "ClipboardDemo", bundleID: "com.example.ClipboardDemo", platform: 1, incident_id: "DEMO-LANGUAGE" },
    baseReport({
      procName: "ClipboardDemo",
      bundleId: "com.example.ClipboardDemo",
      procPath: "/Applications/ClipboardDemo.app/Contents/MacOS/ClipboardDemo",
      exception: { codes: "0x0000000000000000, 0x0000000000000000", rawCodes: [0, 0], type: "EXC_CRASH", signal: "SIGABRT" },
      termination: { flags: 0, code: 6, namespace: "SIGNAL", indicator: "Abort trap: 6", byProc: "ClipboardDemo", byPid: 43395 },
      asi: { "libsystem_c.dylib": ["abort() called"] },
      faultingThread: 0,
      threads: [{
        id: 1000,
        triggered: true,
        queue: "com.apple.main-thread",
        frames: [
          { imageIndex: 0, imageOffset: 28440, symbol: "__pthread_kill", symbolLocation: 8 },
          { imageIndex: 1, imageOffset: 49600, symbol: "abort", symbolLocation: 124 },
        ],
        threadState: threadState(6442479384, "(Syscall)"),
      }],
      lastExceptionBacktrace: [
        { imageIndex: 2, imageOffset: 4096, symbol: "__exceptionPreprocess", symbolLocation: 164 },
        { imageIndex: 3, imageOffset: 8192, symbol: "objc_exception_throw", symbolLocation: 60 },
        { imageIndex: 4, imageOffset: 4728, symbol: "-[NSURL(NSURL) _trueSelf]", symbolLocation: 128 },
      ],
      usedImages: [
        image("libsystem_kernel.dylib", "/usr/lib/system/libsystem_kernel.dylib", 6442450944),
        image("libsystem_c.dylib", "/usr/lib/system/libsystem_c.dylib", 6444544000),
        image("CoreFoundation", "/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation", 6459228160),
        image("libobjc.A.dylib", "/usr/lib/libobjc.A.dylib", 6455033856),
        image("Foundation", "/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation", 6408896512),
      ],
    }),
  );
}

function simulatedGuardIps() {
  return ips(
    { name: "BrowserFaultDemo", bundleID: "com.example.BrowserFaultDemo", platform: 2, incident_id: "DEMO-GUARD" },
    baseReport({
      procName: "BrowserFaultDemo",
      bundleId: "com.example.BrowserFaultDemo",
      procPath: "/private/var/containers/Bundle/Application/DEMO/BrowserFaultDemo.app/BrowserFaultDemo",
      isSimulated: 1,
      exception: { codes: "0x600000000000001f, 0x0000000000000000", rawCodes: [6917529027641081856, 0], type: "EXC_GUARD", subtype: "GUARD_TYPE_USER", message: "namespc 31 reason_code 0x0000000000000000", namespc: 31 },
      termination: { namespace: "WEBKIT", flags: 518, code: 0 },
      faultingThread: 0,
      threads: [{ id: 3000, triggered: true, queue: "com.apple.main-thread", frames: [{ imageIndex: 0, imageOffset: 4096, symbol: "os_fault_with_payload", symbolLocation: 8 }] }],
      usedImages: [image("libsystem_kernel.dylib", "/usr/lib/system/libsystem_kernel.dylib", 6442450944)],
    }),
  );
}

function memoryAccessIps() {
  return ips(
    { name: "MemoryAccessDemo", bundleID: "com.example.MemoryAccessDemo", platform: 7, incident_id: "DEMO-MEMORY" },
    baseReport({
      procName: "MemoryAccessDemo",
      bundleId: "com.example.MemoryAccessDemo",
      procPath: "/Users/example/MemoryAccessDemo.app/MemoryAccessDemo",
      exception: { codes: "0x0000000000000001, 0x0000000000000028", rawCodes: [1, 40], type: "EXC_BAD_ACCESS", signal: "SIGSEGV", subtype: "KERN_INVALID_ADDRESS at 0x0000000000000028" },
      termination: { flags: 0, code: 11, namespace: "SIGNAL", indicator: "Segmentation fault: 11", byProc: "exc handler", byPid: 32106 },
      faultingThread: 1,
      vmregioninfo: "0x28 is not in any region. Bytes before following region: 4294967256 REGION TYPE START - END [ VSIZE] PRT/MAX SHRMOD REGION DETAIL UNUSED SPACE AT START ---> __TEXT 100000000-100080000 [ 512K] r-x/r-x SM=COW /Users/example/MemoryAccessDemo.app/MemoryAccessDemo",
      threads: [
        { id: 4000, triggered: false, frames: [{ imageIndex: 1, imageOffset: 4096, symbol: "start", symbolLocation: 0 }] },
        { id: 4001, triggered: true, queue: "DispatchQueueOrchestrationScheduler_generatorQueue_unspecified_priority", frames: [{ imageIndex: 0, imageOffset: 8192 }, { imageIndex: 2, imageOffset: 12288, symbol: "specialized Future.init(_:)", symbolLocation: 104 }], threadState: threadState(4294975488, "(Data Abort) byte read Translation fault", 40) },
      ],
      usedImages: [
        image("MemoryAccessDemo", "/Users/example/MemoryAccessDemo.app/MemoryAccessDemo", 4294967296),
        image("dyld", "/usr/lib/dyld", 6442450944),
        image("Combine", "/System/Library/Frameworks/Combine.framework/Combine", 5368709120),
      ],
    }),
  );
}

function watchdogIps() {
  return ips(
    { name: "SlowLaunchDemo", bundleID: "com.example.SlowLaunchDemo", platform: 2, incident_id: "DEMO-WATCHDOG" },
    baseReport({
      procName: "SlowLaunchDemo",
      bundleId: "com.example.SlowLaunchDemo",
      procPath: "/private/var/containers/Bundle/Application/DEMO/SlowLaunchDemo.app/SlowLaunchDemo",
      procLaunch: "2026-05-31 11:59:40.0000 -0700",
      captureTime: "2026-05-31 12:00:00.0000 -0700",
      exception: { codes: "0x0000000000000000, 0x0000000000000000", rawCodes: [0, 0], type: "EXC_CRASH", signal: "SIGKILL" },
      termination: { flags: 0, code: 2343432205, namespace: "SPRINGBOARD", indicator: "scene-create watchdog transgression: exhausted real (wall clock) time allowance of 20.00 seconds" },
      faultingThread: 0,
      threads: [{
        id: 5000,
        triggered: true,
        queue: "com.apple.main-thread",
        frames: [
          { imageIndex: 0, imageOffset: 12000, symbol: "SlowLaunchDemo.AppDelegate.application(_:didFinishLaunchingWithOptions:)", symbolLocation: 80 },
          { imageIndex: 1, imageOffset: 4096, symbol: "UIApplicationMain", symbolLocation: 340 },
        ],
      }],
      usedImages: [
        image("SlowLaunchDemo", "/private/var/containers/Bundle/Application/DEMO/SlowLaunchDemo.app/SlowLaunchDemo", 4294967296),
        image("UIKitCore", "/System/Library/PrivateFrameworks/UIKitCore.framework/UIKitCore", 5368709120),
      ],
    }),
  );
}

function ips(metadata, report) {
  return `${JSON.stringify({ bug_type: "309", timestamp: "2026-05-31 12:00:00.0000 -0700", ...metadata })}\n${JSON.stringify(report)}`;
}

function baseReport(overrides) {
  return {
    version: 2,
    incident: overrides.incident ?? "DEMO",
    procName: overrides.procName,
    pid: overrides.pid ?? 42,
    procPath: overrides.procPath,
    bundleInfo: {
      CFBundleIdentifier: overrides.bundleId,
      CFBundleShortVersionString: "1.0",
      CFBundleVersion: "1",
    },
    modelCode: "Mac14,14",
    cpuType: "ARM-64",
    osVersion: { train: "macOS 26.5", build: "25F71", releaseType: "User" },
    parentProc: "launchd",
    parentPid: 1,
    captureTime: overrides.captureTime ?? "2026-05-31 12:00:00.0000 -0700",
    procLaunch: overrides.procLaunch ?? "2026-05-31 11:59:59.0000 -0700",
    ...overrides,
  };
}

function image(name, path, base) {
  return { name, path, base, size: 1048576, uuid: `DEMO-${name}`, arch: "arm64e" };
}

function threadState(pc, esrDescription, far = 0) {
  return {
    flavor: "ARM_THREAD_STATE64",
    pc: { value: pc, matchesCrashFrame: 1 },
    lr: { value: pc - 8 },
    far: { value: far },
    esr: { value: 2449473542, description: esrDescription },
  };
}
