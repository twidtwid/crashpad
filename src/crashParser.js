export class CrashReportError extends Error {
  constructor(message) {
    super(message);
    this.name = "CrashReportError";
  }
}

export class UnsupportedFormatError extends CrashReportError {
  constructor(message) {
    super(message);
    this.name = "UnsupportedFormatError";
  }
}

const PLATFORM_NAMES = new Map([
  [1, "macOS"],
  [2, "iOS"],
  [3, "tvOS"],
  [4, "watchOS"],
  [6, "Mac Catalyst"],
  [7, "iOS Simulator"],
  [8, "tvOS Simulator"],
  [9, "watchOS Simulator"],
]);

const SYSTEM_PATH_PREFIXES = ["/System/", "/usr/lib/"];
const REFERENCE_URLS = {
  acquiringLogs: "https://developer.apple.com/documentation/xcode/acquiring-crash-reports-and-diagnostic-logs",
  fields: "https://developer.apple.com/documentation/xcode/examining-the-fields-in-a-crash-report",
  exceptionTypes: "https://developer.apple.com/documentation/xcode/understanding-the-exception-types-in-a-crash-report",
  jsonFormat: "https://developer.apple.com/documentation/xcode/interpreting-the-json-format-of-a-crash-report",
  symbolication: "https://developer.apple.com/documentation/xcode/adding-identifiable-symbol-names-to-a-crash-report",
  commonCrashes: "https://developer.apple.com/documentation/xcode/identifying-the-cause-of-common-crashes",
  languageException: "https://developer.apple.com/documentation/xcode/addressing-language-exception-crashes",
  memoryAccess: "https://developer.apple.com/documentation/xcode/investigating-memory-access-crashes",
  breakpointTrap: "https://developer.apple.com/documentation/xcode/sigtrap_sigill",
  watchdog: "https://developer.apple.com/documentation/xcode/addressing-watchdog-terminations",
  metricKit: "https://developer.apple.com/documentation/metrickit",
};

export function platformName(value) {
  const numeric = Number(value);
  return PLATFORM_NAMES.get(numeric) ?? `Unknown platform ${value}`;
}

export function parseCrashReport(input, options = {}) {
  const text = normalizeTextInput(input);

  if (looksBinary(text)) {
    throw new UnsupportedFormatError("This file looks binary, not like a text crash report.");
  }

  const trimmedStart = text.trimStart();
  if (trimmedStart.startsWith("{")) {
    return parseIpsJson(text, options);
  }

  if (/^Incident Identifier:/m.test(text) || /^Process:/m.test(text)) {
    return parseLegacyTextCrash(text, options);
  }

  throw new UnsupportedFormatError("Unsupported crash report format. Expected Apple IPS JSON or a legacy text crash report.");
}

export function analyzeCrashReport(parsed) {
  const report = parsed.report ?? {};
  const metadata = parsed.metadata ?? {};
  const usedImages = Array.isArray(report.usedImages) ? report.usedImages : [];
  const faultingThreadIndex = pickFaultingThreadIndex(report);
  const crashedThread = pickCrashedThread(report, faultingThreadIndex);
  const crashedFrames = (crashedThread?.frames ?? []).map((frame) => formatFrame(frame, usedImages));
  const lastExceptionFrames = (report.lastExceptionBacktrace ?? []).map((frame) => formatFrame(frame, usedImages));
  const diagnostics = collectDiagnostics(report);
  const osTermination = classifyOsTermination(report);
  const exception = normalizeException(report, diagnostics, crashedFrames, lastExceptionFrames, osTermination);
  const runtimeSeconds = runtimeDurationSeconds(report.procLaunch, report.captureTime);
  const identity = normalizeIdentity(report, metadata);
  const environment = normalizeEnvironment(report, metadata);
  const binarySummary = summarizeBinaryImages(usedImages, report);
  const symbolication = summarizeSymbolication(crashedFrames, lastExceptionFrames, usedImages);
  const collectionContext = buildCollectionContext(parsed, report, metadata, osTermination);
  const crashStory = buildCrashStory(report, exception, crashedThread, crashedFrames, lastExceptionFrames, diagnostics, symbolication, osTermination);
  const hypothesis = buildHypothesis(exception, crashedFrames, lastExceptionFrames, diagnostics, identity, osTermination);
  const rootCause = buildRootCauseGuide(report, exception, crashedThread, crashedFrames, lastExceptionFrames, diagnostics, identity, osTermination);

  return {
    kind: parsed.kind,
    fileName: parsed.fileName ?? "",
    identity,
    environment,
    runtimeSeconds,
    exception,
    osTermination,
    diagnostics,
    hypothesis,
    rootCause,
    crashStory,
    collectionContext,
    recommendations: buildRecommendations(exception, crashedFrames, lastExceptionFrames, diagnostics, symbolication, identity, osTermination),
    crashedThread: {
      index: faultingThreadIndex,
      id: crashedThread?.id ?? faultingThreadIndex,
      name: crashedThread?.name ?? "",
      queue: crashedThread?.queue ?? "",
      frames: crashedFrames,
      threadState: crashedThread?.threadState ?? null,
    },
    lastException: {
      present: lastExceptionFrames.length > 0,
      frames: lastExceptionFrames,
    },
    binarySummary,
    symbolication,
    raw: parsed,
  };
}

export function formatFrame(frame = {}, usedImages = []) {
  const image = usedImages[frame.imageIndex] ?? {};
  const base = toBigIntOrNull(image.base);
  const offset = toBigIntOrNull(frame.imageOffset);
  const computedAddress = base !== null && offset !== null ? base + offset : null;

  return {
    index: Number.isFinite(Number(frame.frameIndex)) ? Number(frame.frameIndex) : null,
    imageIndex: Number.isFinite(Number(frame.imageIndex)) ? Number(frame.imageIndex) : null,
    imageName: frame.imageName ?? image.name ?? baseName(image.path) ?? image.CFBundleIdentifier ?? "Unknown image",
    imageIdentifier: image.CFBundleIdentifier ?? "",
    imagePath: image.path ?? "",
    imageOffset: Number.isFinite(Number(frame.imageOffset)) ? Number(frame.imageOffset) : null,
    imageOffsetHex: Number.isFinite(Number(frame.imageOffset)) ? hex(frame.imageOffset) : "",
    address: frame.address ?? (computedAddress !== null ? hex(computedAddress, 16) : ""),
    symbol: frame.symbol ?? "<unsymbolicated>",
    symbolLocation: Number.isFinite(Number(frame.symbolLocation)) ? Number(frame.symbolLocation) : null,
    sourceLocation: frame.sourceLocation ?? "",
  };
}

function parseIpsJson(text, options) {
  const content = stripBom(text);
  const firstNewline = content.indexOf("\n");
  if (firstNewline < 0) {
    throw new UnsupportedFormatError("IPS crash reports contain metadata JSON on the first line and report JSON after it.");
  }

  let metadata;
  let report;
  try {
    metadata = JSON.parse(content.slice(0, firstNewline).trim());
  } catch (error) {
    throw new UnsupportedFormatError(`Could not parse IPS metadata JSON: ${error.message}`);
  }

  const logType = String(metadata.bug_type ?? "");
  if (logType !== "309") {
    throw new UnsupportedFormatError(`Log type ${logType || "(unknown)"} is ${ipsLogTypeDescription(logType)}, not an Apple crash report. CrashPad currently analyzes bug_type 309 Apple crash reports; use this file as related diagnostic context.`);
  }

  try {
    report = JSON.parse(content.slice(firstNewline).trim());
  } catch (error) {
    throw new UnsupportedFormatError(`Could not parse IPS crash report JSON: ${error.message}`);
  }

  return {
    kind: "ips-json",
    fileName: options.fileName ?? "",
    metadata,
    report,
  };
}

function ipsLogTypeDescription(logType) {
  if (logType === "288") return "a stackshot diagnostic log";
  if (logType === "298") return "a resource or memory-pressure diagnostic log";
  if (logType === "309") return "an Apple crash report";
  return `an Apple diagnostic log type ${logType || "(unknown)"}`;
}

function parseLegacyTextCrash(text, options) {
  const header = {};
  const lines = stripBom(text).split(/\r?\n/);

  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z /-]+):\s*(.*)$/.exec(line);
    if (match) header[match[1].trim()] = match[2].trim();
  }

  const process = parseProcessLine(header.Process);
  const exceptionType = parseExceptionType(header["Exception Type"]);
  const triggeredThread = Number.parseInt(header["Triggered by Thread"] ?? header["Crashed Thread"] ?? "", 10);
  const threads = parseLegacyThreads(lines, Number.isFinite(triggeredThread) ? triggeredThread : null);

  return {
    kind: "legacy-text",
    fileName: options.fileName ?? "",
    metadata: {
      name: process.name || header.Process || "",
      incident_id: header["Incident Identifier"] || "",
    },
    report: {
      legacyHeader: header,
      incident: header["Incident Identifier"] || "",
      crashReporterKey: header["CrashReporter Key"] || "",
      modelCode: header["Hardware Model"] || "",
      procName: process.name || header.Process || "",
      pid: process.pid,
      procPath: header.Path || "",
      bundleInfo: {
        CFBundleIdentifier: header.Identifier || "",
        CFBundleVersion: header.Version || "",
      },
      cpuType: header["Code Type"] || "",
      parentProc: parseProcessLine(header["Parent Process"]).name || header["Parent Process"] || "",
      parentPid: parseProcessLine(header["Parent Process"]).pid,
      captureTime: header["Date/Time"] || "",
      procLaunch: header["Launch Time"] || "",
      osVersion: { train: header["OS Version"] || "" },
      exception: {
        type: exceptionType.type,
        signal: exceptionType.signal,
        subtype: header["Exception Subtype"] || "",
        codes: header["Exception Codes"] || "",
        message: header["Exception Message"] || "",
      },
      termination: parseLegacyTermination(header["Termination Reason"]),
      faultingThread: Number.isFinite(triggeredThread) ? triggeredThread : threads.findIndex((thread) => thread.triggered),
      threads,
      usedImages: parseLegacyBinaryImages(lines),
    },
  };
}

function parseLegacyThreads(lines, triggeredThread) {
  const threads = [];
  let activeThread = null;

  for (const line of lines) {
    const threadMatch = /^Thread\s+(\d+)(?:\s+name:\s*(.*))?:?$/.exec(line);
    const crashedMatch = /^Thread\s+(\d+)\s+Crashed:?/.exec(line);
    const plainThreadMatch = /^Thread\s+(\d+):$/.exec(line);
    const match = crashedMatch ?? threadMatch ?? plainThreadMatch;

    if (match) {
      const index = Number.parseInt(match[1], 10);
      activeThread = {
        id: index,
        index,
        name: match[2] ?? "",
        triggered: crashedMatch !== null || index === triggeredThread,
        frames: [],
      };
      threads.push(activeThread);
      continue;
    }

    if (!activeThread) continue;
    if (!line.trim() || /^Binary Images:/.test(line) || /^Thread \d+ crashed with/.test(line)) {
      activeThread = null;
      continue;
    }

    const frame = parseLegacyFrame(line);
    if (frame) activeThread.frames.push(frame);
  }

  return threads;
}

function parseLegacyFrame(line) {
  const match = /^\s*(\d+)\s+(.+?)\s{2,}(0x[0-9a-fA-F]+)\s+(.*)$/.exec(line);
  if (!match) return null;

  const frameIndex = Number.parseInt(match[1], 10);
  const imageName = match[2].trim();
  const address = match[3];
  const remainder = match[4].trim();
  const symbolMatch = /^(.*?)\s+\+\s+(\d+)(?:\s+\((.*)\))?$/.exec(remainder);

  return {
    frameIndex,
    imageName,
    address,
    symbol: symbolMatch ? symbolMatch[1].trim() : remainder,
    symbolLocation: symbolMatch ? Number.parseInt(symbolMatch[2], 10) : null,
    sourceLocation: symbolMatch?.[3] ?? "",
  };
}

function parseLegacyBinaryImages(lines) {
  const images = [];
  let inSection = false;

  for (const line of lines) {
    if (/^Binary Images:/.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection || !line.trim()) continue;

    const match = /^\s*(0x[0-9a-fA-F]+)\s+-\s+(0x[0-9a-fA-F]+)\s+(.+?)\s+<([A-Fa-f0-9-]+)>\s+(.+)$/.exec(line);
    if (!match) continue;

    const nameChunk = match[3].trim();
    const path = match[5].trim();
    images.push({
      base: Number.parseInt(match[1], 16),
      end: Number.parseInt(match[2], 16),
      name: baseName(path) ?? nameChunk.replace(/^\+/, "").split(/\s+\(/)[0],
      path,
      uuid: match[4],
      source: nameChunk.startsWith("+") ? "P" : "S",
    });
  }

  return images;
}

function parseExceptionType(value = "") {
  const match = /^([A-Z0-9_]+)(?:\s+\(([^)]+)\))?/.exec(value.trim());
  return {
    type: match?.[1] ?? value.trim(),
    signal: match?.[2] ?? "",
  };
}

function parseLegacyTermination(value = "") {
  if (!value) return {};
  const parts = value.split(/\s*,\s*/);
  return {
    namespace: parts[0] ?? "",
    indicator: value,
  };
}

function parseProcessLine(value = "") {
  const match = /^(.*?)\s+\[(\d+)\]$/.exec(value.trim());
  return {
    name: match ? match[1].trim() : value.trim(),
    pid: match ? Number.parseInt(match[2], 10) : null,
  };
}

function normalizeIdentity(report, metadata) {
  return {
    process: report.procName ?? metadata.name ?? metadata.app_name ?? "",
    pid: report.pid ?? null,
    path: report.procPath ?? "",
    bundleId: report.bundleInfo?.CFBundleIdentifier ?? metadata.bundleID ?? "",
    version: versionString(report.bundleInfo, metadata),
    incident: report.incident ?? metadata.incident_id ?? "",
    crashReporterKey: report.crashReporterKey ?? "",
    firstPartyApple: Boolean(metadata.is_first_party) || String(report.bundleInfo?.CFBundleIdentifier ?? "").startsWith("com.apple."),
  };
}

function normalizeEnvironment(report, metadata) {
  const platform = metadata.platform !== undefined ? platformName(metadata.platform) : inferPlatformFromOs(report.osVersion?.train ?? metadata.os_version);
  return {
    platform,
    cpuType: report.cpuType ?? "",
    translated: Boolean(report.translated),
    role: report.procRole ?? "",
    model: report.modelCode ?? "",
    osVersion: formatOsVersion(report.osVersion, metadata.os_version),
    releaseType: report.osVersion?.releaseType ?? "",
    parentProcess: report.parentProc ? `${report.parentProc}${report.parentPid ? ` [${report.parentPid}]` : ""}` : "",
    coalition: report.coalitionName ? `${report.coalitionName}${report.coalitionID ? ` [${report.coalitionID}]` : ""}` : "",
    launchedAt: report.procLaunch ?? "",
    crashedAt: report.captureTime ?? metadata.timestamp ?? "",
    uptimeSeconds: Number.isFinite(Number(report.uptime)) ? Number(report.uptime) : null,
  };
}

function normalizeException(report, diagnostics, crashedFrames, lastExceptionFrames, osTermination) {
  const exception = report.exception ?? {};
  const termination = report.termination ?? {};
  const category = exceptionCategory(exception, termination, diagnostics, crashedFrames, lastExceptionFrames, osTermination);

  return {
    type: exception.type ?? "",
    signal: exception.signal ?? "",
    codes: exception.codes ?? formatRawCodes(exception.rawCodes),
    subtype: exception.subtype ?? "",
    message: exception.message ?? "",
    terminationNamespace: termination.namespace ?? "",
    terminationCode: termination.code ?? null,
    terminationCodeHex: Number.isFinite(Number(termination.code)) ? hex(termination.code) : "",
    terminationIndicator: termination.indicator ?? "",
    terminatingProcess: termination.byProc ? `${termination.byProc}${termination.byPid ? ` [${termination.byPid}]` : ""}` : "",
    category,
    notes: exceptionNotes(report),
  };
}

function exceptionCategory(exception, termination, diagnostics, crashedFrames, lastExceptionFrames, osTermination) {
  const type = exception.type ?? "";
  const signal = exception.signal ?? "";
  const topSymbol = crashedFrames[0]?.symbol ?? "";

  if (type === "EXC_BAD_ACCESS" || /SIGSEGV|SIGBUS/.test(signal)) return "Memory access";
  if (type === "EXC_RESOURCE") return "Resource policy";
  if (type === "EXC_GUARD") return "Guard violation";
  if (osTermination.kind) return osTermination.label;
  if (type === "EXC_CRASH" && (signal === "SIGABRT" || lastExceptionFrames.length || diagnostics.some((item) => /abort\(\)|exception/i.test(item.message)))) {
    return "Abort / language exception";
  }
  if (type === "EXC_BREAKPOINT" || signal === "SIGTRAP" || /assertionFailure|precondition|fatalError/.test(topSymbol)) {
    return "Breakpoint / assertion trap";
  }
  if (termination.namespace && termination.namespace !== "SIGNAL") return `${termination.namespace} termination`;
  return type || signal || "Unknown";
}

function collectDiagnostics(report) {
  const diagnostics = [];

  if (report.asi && typeof report.asi === "object") {
    for (const [source, value] of Object.entries(report.asi)) {
      const messages = Array.isArray(value) ? value : [value];
      for (const message of messages) {
        if (message) diagnostics.push({ source, message: String(message) });
      }
    }
  }

  const vmRegionInfo = report.vmregioninfo ?? report.vmRegionInfo;
  if (vmRegionInfo) diagnostics.push({ source: "VM Region Info", message: vmRegionInfo });
  if (report.os_fault?.process) diagnostics.push({ source: "OS Fault", message: `Fault recorded for ${report.os_fault.process}` });
  if (report.exception?.message) diagnostics.push({ source: "Exception Message", message: report.exception.message });

  return diagnostics;
}

function classifyOsTermination(report = {}) {
  const termination = report.termination ?? {};
  const exception = report.exception ?? {};
  const namespace = String(termination.namespace ?? "").toUpperCase();
  const codeHex = Number.isFinite(Number(termination.code)) ? hex(termination.code) : String(termination.code ?? "");
  const indicator = String(termination.indicator ?? "");
  const message = String(exception.message ?? "");
  const combined = [namespace, codeHex, indicator, message, exception.type, exception.signal].filter(Boolean).join(" ");

  if (/8badf00d/i.test(codeHex) || ((namespace === "SPRINGBOARD" || namespace === "FRONTBOARD") && /watchdog|exhausted.*time|scene|launch|resume|suspend/i.test(combined))) {
    return {
      kind: "watchdog",
      label: "Watchdog termination",
      summary: watchdogSummary(namespace, indicator),
      advice: "Use lifecycle timing rather than only frame 0: look at launch/resume/scene/background work, especially synchronous main-thread I/O and waits.",
      referenceUrl: REFERENCE_URLS.watchdog,
    };
  }

  if (/JETSAM|memory pressure|highwater|per-process-limit/i.test(combined)) {
    return {
      kind: "jetsam",
      label: "Memory pressure termination",
      summary: "The OS appears to have killed the process under memory pressure rather than because one thread threw a language or CPU exception.",
      advice: "Correlate with memory footprint, MetricKit memory diagnostics, and nearby jetsam logs before treating the crashed thread as the sole cause.",
      referenceUrl: REFERENCE_URLS.acquiringLogs,
    };
  }

  if (/THERMAL|thermal/i.test(combined)) {
    return {
      kind: "thermal",
      label: "Thermal termination",
      summary: "The OS appears to have ended the process because the device was under thermal pressure.",
      advice: "Correlate with device conditions, CPU/GPU activity, and MetricKit diagnostics.",
      referenceUrl: REFERENCE_URLS.acquiringLogs,
    };
  }

  if (/CODESIGN|code signature|invalid signature/i.test(combined)) {
    return {
      kind: "code-signature",
      label: "Code signature termination",
      summary: "The OS appears to have ended the process because code signing or executable validation failed.",
      advice: "Check the app bundle, embedded frameworks, entitlements, provisioning, and distribution channel before debugging app logic.",
      referenceUrl: REFERENCE_URLS.acquiringLogs,
    };
  }

  if (namespace === "DYLD") {
    return {
      kind: "dyld",
      label: "Dynamic linker termination",
      summary: "The dynamic linker ended the process while loading code or resolving a dependency.",
      advice: "Inspect missing libraries, incompatible symbols, install names, and deployment-target mismatches.",
      referenceUrl: REFERENCE_URLS.exceptionTypes,
    };
  }

  if (namespace && namespace !== "SIGNAL") {
    return {
      kind: "os",
      label: `${namespace} termination`,
      summary: `The ${namespace} subsystem recorded the process exit reason.`,
      advice: "Use the termination namespace and message to scope the OS subsystem before changing app code.",
      referenceUrl: REFERENCE_URLS.fields,
    };
  }

  return {
    kind: "",
    label: "",
    summary: "",
    advice: "",
  };
}

function watchdogSummary(namespace, indicator) {
  const seconds = /(\d+(?:\.\d+)?)\s*seconds?/i.exec(indicator)?.[1];
  const budget = seconds ? ` after it exceeded a ${formatSeconds(Number(seconds))} wall-clock allowance` : "";
  return `${namespace || "The OS"} watchdog killed the app${budget}. The stack shows what was running when the watchdog fired, not every operation that contributed to the timeout.`;
}

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds)) return "time";
  const rendered = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${rendered} seconds`;
}

function buildCollectionContext(parsed, report, metadata, osTermination) {
  const primarySource = parsed.kind === "legacy-text" ? "Legacy text crash report" : "IPS crash report";
  const relatedSources = [
    {
      label: "Xcode Devices and Simulators",
      detail: "Use local device logs and direct symbolication when reproducing or when a user provides raw diagnostics from a device.",
      url: REFERENCE_URLS.acquiringLogs,
    },
    {
      label: "Xcode Crashes Organizer",
      detail: osTermination.kind
        ? "Organizer is useful for App Store and TestFlight crash aggregation, but watchdog, jetsam, thermal, invalid code signature, and other OS termination reports may not always appear in Xcode Organizer."
        : "Organizer is useful for App Store and TestFlight crash aggregation when users share diagnostics and matching symbols are available.",
      url: REFERENCE_URLS.acquiringLogs,
    },
    {
      label: "MetricKit",
      detail: "MetricKit payloads can corroborate crashes with hang, launch, CPU exception, disk write, memory, and signpost diagnostics collected by the app.",
      url: REFERENCE_URLS.metricKit,
    },
  ];

  return {
    primarySource,
    bugType: String(metadata.bug_type ?? ""),
    incident: report.incident ?? metadata.incident_id ?? "",
    summary: "Read the source and related diagnostics together: crash reports show the stop point, while logs and metrics often explain the path that led there.",
    relatedSources,
  };
}

function buildCrashStory(report, exception, crashedThread, crashedFrames, lastExceptionFrames, diagnostics, symbolication, osTermination) {
  const checks = [];
  const mechanism = [exception.type, exception.signal ? `(${exception.signal})` : ""].filter(Boolean).join(" ") || "Unknown exception";
  const topFrame = crashedFrames[0] ?? null;

  checks.push({
    label: "Crash mechanism",
    status: "mechanism",
    detail: `${mechanism} explains how the process stopped. Treat it as the mechanism first, then use termination, diagnostics, and frames to infer cause.`,
    referenceUrl: REFERENCE_URLS.exceptionTypes,
  });

  if (osTermination.kind) {
    checks.push({
      label: "Termination reason",
      status: "important",
      detail: `${osTermination.label}: ${osTermination.summary}`,
      referenceUrl: osTermination.referenceUrl || REFERENCE_URLS.fields,
    });
  } else if (exception.terminationNamespace) {
    checks.push({
      label: "Termination reason",
      status: "present",
      detail: `${exception.terminationNamespace} ${exception.terminationCodeHex || exception.terminationCode || ""} ${exception.terminationIndicator || ""}`.trim(),
      referenceUrl: REFERENCE_URLS.fields,
    });
  }

  if (lastExceptionFrames.length) {
    const throwFrame = firstInterestingFrame(lastExceptionFrames) ?? lastExceptionFrames[0];
    checks.push({
      label: "Primary stack",
      status: "strong",
      detail: `Last Exception Backtrace is present; use ${frameSummary(throwFrame)} before focusing on abort or pthread frames.`,
      referenceUrl: REFERENCE_URLS.languageException,
    });
  } else {
    checks.push({
      label: "Primary stack",
      status: topFrame ? "present" : "missing",
      detail: topFrame ? `Triggered thread ${threadLabel(crashedThread, report.faultingThread) || "0"} starts at ${frameSummary(topFrame)}.` : "No crashed-thread frames were present.",
      referenceUrl: REFERENCE_URLS.fields,
    });
  }

  if (exception.category === "Memory access") {
    const address = exceptionAddress(report.exception ?? {});
    if (address) {
      checks.push({
        label: "Faulting address",
        status: isVeryLowAddress(address) ? "important" : "present",
        detail: `${address}${isVeryLowAddress(address) ? " is a low address, which often indicates a nil or near-nil dereference." : " is the address reported by the exception subtype or raw exception codes."}`,
        referenceUrl: REFERENCE_URLS.memoryAccess,
      });
    }
  }

  const diagnostic = diagnostics.find((item) => item.source !== "VM Region Info") ?? diagnostics[0];
  if (diagnostic) {
    checks.push({
      label: diagnostic.source,
      status: "context",
      detail: truncateMiddle(diagnostic.message, 220),
      referenceUrl: diagnosticReferenceUrl(diagnostic.source, exception.category),
    });
  }

  checks.push({
    label: "Symbolication",
    status: symbolication.fullySymbolicated ? "ready" : "needs dSYM",
    detail: symbolication.advice,
    referenceUrl: REFERENCE_URLS.symbolication,
  });

  return {
    verdict: checks.map((check) => check.detail).slice(0, 3).join(" "),
    checks,
  };
}

function buildRootCauseGuide(report, exception, crashedThread, crashedFrames, lastExceptionFrames, diagnostics, identity, osTermination) {
  const signals = [];
  const mechanism = [exception.type, exception.signal ? `(${exception.signal})` : ""].filter(Boolean).join(" ") || "Unknown exception";
  const termination = [exception.terminationNamespace, exception.terminationCodeHex || exception.terminationCode, exception.terminationIndicator]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join(" ");
  const triggeredThread = threadLabel(crashedThread, report.faultingThread);
  const topFrame = crashedFrames[0] ?? null;

  signals.push({
    label: "Crash mechanism",
    value: mechanism,
    meaning: "This field explains how the process quit. Apple notes that exception information is the mechanism, not always the root cause.",
    referenceUrl: REFERENCE_URLS.exceptionTypes,
  });

  if (termination) {
    signals.push({
      label: "Termination Reason",
      value: termination,
      meaning: terminationMeaning(exception.terminationNamespace),
      referenceUrl: osTermination.referenceUrl || REFERENCE_URLS.fields,
    });
  }

  if (triggeredThread) {
    signals.push({
      label: "Triggered Thread",
      value: triggeredThread,
      meaning: "This is the thread on which the exception originated; frame 0 is the code executing when that thread stopped.",
      referenceUrl: REFERENCE_URLS.fields,
    });
  }

  if (exception.notes.includes("SIMULATED")) {
    signals.push({
      label: "Exception Note",
      value: "SIMULATED",
      meaning: "Apple documents SIMULATED as not being a normal crash; the process may have been asked to quit after a generated fault report.",
      referenceUrl: REFERENCE_URLS.jsonFormat,
    });
  }

  const diagnostic = diagnostics.find((item) => !(exception.category === "Memory access" && item.source === "VM Region Info"));
  if (diagnostic) {
    signals.push({
      label: diagnostic.source,
      value: truncateMiddle(diagnostic.message, 260),
      meaning: diagnosticMeaning(diagnostic.source, exception.category),
      referenceUrl: diagnosticReferenceUrl(diagnostic.source, exception.category),
    });
  }

  if (exception.notes.includes("SIMULATED")) {
    return {
      headline: "Not a normal app crash: simulated fault report",
      confidence: "high",
      summary: `${identity.process || "The process"} is marked SIMULATED. Treat this as an OS- or subsystem-generated fault report rather than a straightforward app crash; ${termination || mechanism} is the strongest scope clue.`,
      primaryFrame: frameSummary(topFrame),
      signals,
    };
  }

  if (osTermination.kind) {
    signals.push({
      label: "OS termination",
      value: osTermination.label,
      meaning: osTermination.summary,
      referenceUrl: osTermination.referenceUrl || REFERENCE_URLS.fields,
    });
    if (osTermination.advice) {
      signals.push({
        label: "Collection clue",
        value: osTermination.advice,
        meaning: "OS-enforced exits often need lifecycle timing, device logs, and MetricKit context in addition to the crashed-thread stack.",
        referenceUrl: osTermination.kind === "watchdog" ? REFERENCE_URLS.watchdog : REFERENCE_URLS.acquiringLogs,
      });
    }

    return {
      headline: osTermination.label,
      confidence: osTermination.kind === "watchdog" ? "high" : "medium",
      summary: `${osTermination.summary} ${osTermination.advice}`.trim(),
      primaryFrame: frameSummary(topFrame),
      signals,
    };
  }

  if (exception.category === "Abort / language exception" && lastExceptionFrames.length) {
    const throwFrame = firstInterestingFrame(lastExceptionFrames) ?? lastExceptionFrames[0];
    signals.push({
      label: "Last Exception Backtrace",
      value: frameSummary(throwFrame),
      meaning: "For an uncaught language exception, Apple documents this stack as the path to the throwing API; abort and pthread frames are only termination mechanics.",
      referenceUrl: REFERENCE_URLS.languageException,
    });

    return {
      headline: "Likely uncaught language exception",
      confidence: "high",
      summary: `The report ended with ${mechanism}, but the useful root-cause path is the Last Exception Backtrace. It points at ${frameSummary(throwFrame)}, so investigate the caller chain there before focusing on abort/pthread_kill frames.`,
      primaryFrame: frameSummary(throwFrame),
      signals,
    };
  }

  if (exception.category === "Breakpoint / assertion trap") {
    const isSwiftTrap = crashedFrames.some((frame) => /_assertionFailure|fatalError|precondition|swift/i.test(frame.symbol || frame.imageName || ""));
    const headline = isSwiftTrap ? "Swift runtime trap or assertion" : "Framework trap at an unrecoverable condition";
    signals.push({
      label: "Top crashed frame",
      value: frameSummary(topFrame),
      meaning: isSwiftTrap
        ? "Apple documents EXC_BREAKPOINT/SIGTRAP as a trace trap; Swift uses this pattern for unrecoverable runtime errors and assertions."
        : "Apple documents EXC_BREAKPOINT/SIGTRAP as a trace trap; lower-level frameworks use it when they hit an unrecoverable condition.",
      referenceUrl: REFERENCE_URLS.breakpointTrap,
    });

    return {
      headline,
      confidence: topFrame ? "medium" : "low",
      summary: `${mechanism} is a deliberate trap rather than a random memory fault. Start with ${frameSummary(topFrame)} and then read the adjacent frames for the state that made the runtime or framework stop.`,
      primaryFrame: frameSummary(topFrame),
      signals,
    };
  }

  if (exception.category === "Memory access") {
    const address = exceptionAddress(report.exception ?? {});
    const subtypeMeaning = memorySubtypeMeaning(exception.subtype);
    const vmInfo = diagnostics.find((item) => item.source === "VM Region Info");
    if (exception.subtype) {
      signals.push({
        label: "Exception Subtype",
        value: exception.subtype,
        meaning: subtypeMeaning,
        referenceUrl: REFERENCE_URLS.memoryAccess,
      });
    }
    if (vmInfo) {
      signals.push({
        label: "VM Region Info",
        value: truncateMiddle(vmInfo.message, 300),
        meaning: "For memory access crashes, Apple documents VM Region Info as the address-space clue that shows whether the faulting address is unmapped or protected.",
        referenceUrl: REFERENCE_URLS.memoryAccess,
      });
    }
    const stateSummary = threadStateSummary(crashedThread?.threadState);
    if (stateSummary) {
      signals.push({
        label: "Thread State",
        value: stateSummary,
        meaning: "Apple documents thread state as CPU register data captured at termination; pc/lr/far/esr help distinguish data access from instruction fetch failures.",
        referenceUrl: REFERENCE_URLS.fields,
      });
    }

    return {
      headline: "Likely invalid memory access",
      confidence: exception.subtype || vmInfo ? "high" : "medium",
      summary: `${mechanism}${address ? ` at ${address}` : ""} indicates memory was used in an unexpected way. ${address && isVeryLowAddress(address) ? "The address is very low, which often means a nil or near-nil pointer was dereferenced. " : ""}${subtypeMeaning}`,
      primaryFrame: frameSummary(topFrame),
      signals,
    };
  }

  if (exception.category === "Guard violation") {
    signals.push({
      label: "Exception Message",
      value: exception.message || exception.subtype || mechanism,
      meaning: "EXC_GUARD means the process violated a guarded system resource; the namespace and reason code narrow which subsystem reported it.",
      referenceUrl: REFERENCE_URLS.exceptionTypes,
    });
    return {
      headline: "Guarded resource violation",
      confidence: "medium",
      summary: `${mechanism} points to a guarded resource violation. Use the namespace, reason code, and top frames to identify the protected resource or subsystem.`,
      primaryFrame: frameSummary(topFrame),
      signals,
    };
  }

  return {
    headline: "Root cause needs full-report correlation",
    confidence: "low",
    summary: `${mechanism} identifies the termination path, but the report does not match a stronger documented pattern. Compare the triggered thread, diagnostics, binary images, OS build, and similar reports before assigning a cause.`,
    primaryFrame: frameSummary(topFrame),
    signals,
  };
}

function buildHypothesis(exception, crashedFrames, lastExceptionFrames, diagnostics, identity, osTermination) {
  const top = crashedFrames[0];
  const lastInteresting = firstInterestingFrame(lastExceptionFrames);

  if (osTermination.kind) {
    return `${osTermination.label}: ${osTermination.summary} ${osTermination.advice}`.trim();
  }

  if (exception.category === "Abort / language exception" && lastExceptionFrames.length) {
    const pointer = lastInteresting ? `${lastInteresting.symbol} in ${lastInteresting.imageName}` : "the Last Exception Backtrace";
    return `The process aborted after an uncaught Objective-C exception or C++ language exception. The Last Exception Backtrace points at ${pointer}, so start there rather than at pthread_kill/abort frames.`;
  }

  if (exception.category === "Breakpoint / assertion trap") {
    const pointer = top ? `${top.symbol} in ${top.imageName}` : "the crashed thread";
    if (/_assertionFailure|swift_|precondition|fatalError/.test(top?.symbol ?? "")) {
      return `The process stopped on a Swift assertion, precondition, fatalError, or deliberate breakpoint trap. The top crashed frame is ${pointer}; the surrounding frames show the runtime state that triggered the assertion.`;
    }
    return `The process stopped on a breakpoint, assertion, or framework invariant trap. The top crashed frame is ${pointer}; inspect the adjacent frames and diagnostic fields to identify which invariant failed.`;
  }

  if (exception.category === "Memory access") {
    return "The exception is a memory access fault. Use the exception subtype, VM Region Info, and crashed-thread registers to determine whether this was a null dereference, use-after-free, or invalid instruction/data fetch.";
  }

  if (diagnostics.length) {
    return `The strongest clue is the diagnostic message "${diagnostics[0].message}". Read it with the exception and crashed-thread frames before changing code.`;
  }

  return `The report identifies ${identity.process || "the process"} terminating with ${exception.type || exception.signal || "an unknown exception"}. Start with the crashed thread and compare it with any related non-crashed threads.`;
}

function buildRecommendations(exception, crashedFrames, lastExceptionFrames, diagnostics, symbolication, identity, osTermination) {
  const items = [];

  if (!symbolication.fullySymbolicated) {
    items.push("Symbolicate the report with the matching dSYM/archive before drawing final conclusions.");
  }

  if (osTermination.kind === "watchdog") {
    items.push("Reproduce the launch, scene, foreground, background, or resume path outside the debugger; the watchdog budget changes when a debugger is attached.");
    items.push("Measure main-thread work around the lifecycle event named by the termination indicator and move blocking I/O or synchronous waits off that path.");
  } else if (osTermination.kind) {
    items.push(`Treat this as an OS-enforced ${osTermination.label.toLowerCase()}; collect matching device logs, MetricKit diagnostics, and user actions before assigning the cause to app code.`);
  }

  if (exception.category === "Abort / language exception") {
    items.push("Use the Last Exception Backtrace as the primary source; abort and pthread_kill frames are termination mechanics, not the root call site.");
    if (diagnostics.length) items.push("Correlate Application Specific Information with the API named in the exception path.");
  }

  if (exception.category === "Breakpoint / assertion trap") {
    items.push("Look for assertions, preconditions, fatal errors, or framework invariants around the top few crashed-thread frames.");
  }

  if (exception.category === "Memory access") {
    items.push("Inspect VM Region Info and the crashed-thread register state; run with Address Sanitizer or Zombies if this is reproducible.");
  }

  if (identity.firstPartyApple) {
    items.push("This is an Apple first-party process; capture the user action and OS build, update macOS if possible, and file Feedback with the full report if it recurs.");
  }

  items.push("Group recurring reports by process, exception type, OS build, hardware model, and top application/framework frames.");
  items.push("Keep the complete crash report attached; partial reports omit binary images, registers, and diagnostic fields needed for diagnosis.");

  return dedupe(items);
}

function summarizeBinaryImages(images, report) {
  const processName = report.procName ?? "";
  const bundleId = report.bundleInfo?.CFBundleIdentifier ?? "";
  const counts = {
    total: images.length,
    process: 0,
    system: 0,
    privateFrameworks: 0,
    thirdPartyOrUser: 0,
  };
  const interesting = [];

  for (const image of images) {
    const path = image.path ?? "";
    const isProcess = image.name === processName || image.CFBundleIdentifier === bundleId || path === report.procPath;
    const isSystem = SYSTEM_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));

    if (isProcess) counts.process += 1;
    if (isSystem) counts.system += 1;
    if (path.includes("/PrivateFrameworks/")) counts.privateFrameworks += 1;
    if (!isSystem && !isProcess) counts.thirdPartyOrUser += 1;

    if (isProcess || path.includes("/PrivateFrameworks/") || interesting.length < 8) {
      interesting.push({
        name: image.name ?? baseName(path) ?? "",
        identifier: image.CFBundleIdentifier ?? "",
        version: versionString(image, {}),
        arch: image.arch ?? "",
        path,
        uuid: image.uuid ?? "",
      });
    }
  }

  return { counts, interesting: dedupeImages(interesting).slice(0, 24) };
}

function summarizeSymbolication(crashedFrames, lastExceptionFrames, usedImages) {
  const frames = [...crashedFrames, ...lastExceptionFrames];
  const unsymbolicated = frames.filter((frame) => !frame.symbol || frame.symbol === "<unsymbolicated>");
  const missingImageUuids = dedupeImages(unsymbolicated.map((frame) => {
    const image = usedImages[frame.imageIndex] ?? {};
    return {
      name: frame.imageName || image.name || baseName(image.path) || "Unknown image",
      identifier: image.CFBundleIdentifier ?? frame.imageIdentifier ?? "",
      uuid: image.uuid ?? "",
      arch: image.arch ?? "",
      path: image.path ?? frame.imagePath ?? "",
    };
  })).filter((image) => image.uuid || image.name || image.path);
  return {
    totalFramesChecked: frames.length,
    unsymbolicatedFrames: unsymbolicated.length,
    fullySymbolicated: frames.length > 0 && unsymbolicated.length === 0,
    missingImageUuids,
    advice: missingImageUuids.length
      ? "Find the matching dSYM or archived build for each listed image UUID, then re-symbolicate before relying on exact frame names."
      : "Checked crash and last-exception stacks already include symbol names.",
    referenceUrl: REFERENCE_URLS.symbolication,
  };
}

function pickFaultingThreadIndex(report) {
  if (Number.isFinite(Number(report.faultingThread))) return Number(report.faultingThread);
  const triggered = (report.threads ?? []).findIndex((thread) => thread.triggered);
  return triggered >= 0 ? triggered : 0;
}

function pickCrashedThread(report, faultingThreadIndex) {
  const threads = Array.isArray(report.threads) ? report.threads : [];
  return threads[faultingThreadIndex] ?? threads.find((thread) => thread.triggered) ?? threads[0] ?? null;
}

function firstInterestingFrame(frames) {
  return frames.find((frame) => !/^(__pthread_kill|pthread_kill|abort|objc_exception_throw|__exceptionPreprocess|_objc_terminate|std::__terminate|__cxa_throw|start)/.test(frame.symbol));
}

function exceptionNotes(report) {
  const notes = [];
  if (report.isCorpse) notes.push("EXC_CORPSE_NOTIFY");
  if (report.isNonFatal) notes.push("NON-FATAL CONDITION");
  if (report.isSimulated) notes.push("SIMULATED");
  return notes;
}

function versionString(bundleInfo = {}, metadata = {}) {
  const shortVersion = bundleInfo.CFBundleShortVersionString ?? metadata.app_version ?? "";
  const build = bundleInfo.CFBundleVersion ?? metadata.build_version ?? "";
  if (shortVersion && build && shortVersion !== build) return `${shortVersion} (${build})`;
  return shortVersion || build || "";
}

function formatOsVersion(osVersion = {}, fallback = "") {
  if (typeof osVersion === "string") return osVersion;
  if (!osVersion || typeof osVersion !== "object") return fallback || "";
  const train = osVersion.train ?? "";
  const build = osVersion.build ? ` (${osVersion.build})` : "";
  return `${train}${build}` || fallback || "";
}

function inferPlatformFromOs(value = "") {
  if (/macOS|Mac OS/i.test(value)) return "macOS";
  if (/iPhone|iPad|iOS/i.test(value)) return "iOS";
  if (/tvOS/i.test(value)) return "tvOS";
  if (/watchOS/i.test(value)) return "watchOS";
  return "";
}

function runtimeDurationSeconds(launch, crash) {
  const launchDate = parseAppleDate(launch);
  const crashDate = parseAppleDate(crash);
  if (!launchDate || !crashDate) return null;
  return (crashDate.getTime() - launchDate.getTime()) / 1000;
}

function parseAppleDate(value = "") {
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s+([+-]\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const fraction = (match[3] ?? "0").slice(0, 3).padEnd(3, "0");
  const iso = `${match[1]}T${match[2]}.${fraction}${match[4]}:${match[5]}`;
  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function formatRawCodes(rawCodes) {
  if (!Array.isArray(rawCodes)) return "";
  return rawCodes.map((code) => hex(code, 16)).join(", ");
}

function hex(value, minWidth = 0) {
  const big = toBigIntOrNull(value);
  if (big === null) return "";
  const digits = big.toString(16).padStart(minWidth, "0");
  return `0x${digits}`;
}

function toBigIntOrNull(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value) {
    try {
      return value.startsWith("0x") ? BigInt(value) : BigInt(Number(value));
    } catch {
      return null;
    }
  }
  return null;
}

function threadLabel(thread, fallbackIndex) {
  if (!thread) return "";
  const index = Number.isFinite(Number(fallbackIndex)) ? Number(fallbackIndex) : thread.index ?? thread.id ?? "";
  const labels = [];
  if (index !== "") labels.push(`Thread ${index}`);
  if (thread.queue) labels.push(thread.queue);
  if (thread.name) labels.push(thread.name);
  return labels.join(" - ");
}

function terminationMeaning(namespace = "") {
  if (!namespace) return "The operating system or runtime recorded this as the reason the process was quit.";
  if (namespace === "SIGNAL") return "The process ended through a POSIX signal; read this with the exception type to separate termination mechanics from the earlier failure.";
  if (namespace === "DYLD") return "The dynamic linker quit the process, often because a required library or symbol could not be loaded.";
  if (namespace === "SPRINGBOARD" || namespace === "FRONTBOARD") return "The app lifecycle watchdog or foreground/background manager quit the process; check termination descriptions and main-thread work.";
  return `The ${namespace} subsystem recorded the process exit reason; use this namespace to scope which OS component reported the fault.`;
}

function diagnosticMeaning(source, category) {
  if (source === "VM Region Info") return "For memory access crashes, this explains where the faulting address sits relative to valid memory regions.";
  if (source === "Exception Message") return "This is human-readable information extracted from the exception codes and often names the reporting subsystem or reason.";
  if (/Application Specific Information|libsystem_c/.test(source)) return "Application Specific Information records framework or process messages emitted immediately before termination.";
  if (category === "Abort / language exception") return "Diagnostic messages can identify the API or framework condition that caused the abort.";
  return "Additional diagnostic text is directly related to the exception type and can narrow the root-cause search.";
}

function diagnosticReferenceUrl(source, category) {
  if (source === "VM Region Info" || category === "Memory access") return REFERENCE_URLS.memoryAccess;
  if (source === "Exception Message") return REFERENCE_URLS.fields;
  if (/Application Specific Information|OS Fault|Diagnostic|libsystem_c/.test(source)) return REFERENCE_URLS.commonCrashes;
  if (category === "Abort / language exception") return REFERENCE_URLS.languageException;
  return REFERENCE_URLS.fields;
}

function memorySubtypeMeaning(subtype = "") {
  if (/KERN_INVALID_ADDRESS/.test(subtype)) return "KERN_INVALID_ADDRESS means the crashed thread accessed unmapped memory.";
  if (/KERN_PROTECTION_FAILURE/.test(subtype)) return "KERN_PROTECTION_FAILURE means the address exists, but current permissions forbid this access.";
  if (/KERN_MEMORY_ERROR/.test(subtype)) return "KERN_MEMORY_ERROR means memory could not return data at that moment, such as an unavailable memory-mapped file.";
  if (/EXC_ARM_DA_ALIGN/.test(subtype)) return "EXC_ARM_DA_ALIGN means the thread tried to access memory that was not appropriately aligned.";
  return "The subtype is the human-readable form of the processor-specific exception codes.";
}

function exceptionAddress(exception = {}) {
  const subtypeMatch = /at\s+(0x[0-9a-fA-F]+)/.exec(exception.subtype ?? "");
  if (subtypeMatch) return hex(subtypeMatch[1], 16);
  if (Array.isArray(exception.rawCodes) && exception.rawCodes.length > 1) return hex(exception.rawCodes[1], 16);
  return "";
}

function isVeryLowAddress(address) {
  const value = toBigIntOrNull(address);
  return value !== null && value >= 0n && value < 4096n;
}

function threadStateSummary(threadState = null) {
  if (!threadState || typeof threadState !== "object") return "";
  const parts = [];
  for (const register of ["pc", "lr", "far", "esr"]) {
    const value = threadState[register];
    if (!value || typeof value !== "object") continue;
    const rendered = value.description ? `${hex(value.value, 16)} ${value.description}` : hex(value.value, 16);
    if (rendered) parts.push(`${register}=${rendered}`);
  }
  return parts.join("; ");
}

function frameSummary(frame) {
  if (!frame) return "No frame available";
  const symbol = frame.symbol && frame.symbol !== "<unsymbolicated>" ? frame.symbol : "<unsymbolicated>";
  const image = frame.imageName || "unknown image";
  return `${symbol} in ${image}${frame.address ? ` at ${frame.address}` : ""}`;
}

function truncateMiddle(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const edge = Math.floor((maxLength - 3) / 2);
  return `${text.slice(0, edge)}...${text.slice(-edge)}`;
}

function looksBinary(text) {
  return /[\u0000-\u0008\u000E-\u001F]/.test(text.slice(0, 512));
}

function normalizeTextInput(input) {
  if (typeof input !== "string") {
    throw new UnsupportedFormatError("Crash report input must be decoded text.");
  }
  return input;
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function baseName(path = "") {
  if (!path) return "";
  const clean = path.replace(/\\/g, "/");
  return clean.slice(clean.lastIndexOf("/") + 1) || clean;
}

function dedupe(items) {
  return [...new Set(items)];
}

function dedupeImages(images) {
  const seen = new Set();
  return images.filter((image) => {
    const key = `${image.name}:${image.uuid}:${image.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
