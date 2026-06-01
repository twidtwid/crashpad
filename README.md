# Crash Reporter

A small local web app for analyzing Apple crash reports. It accepts `.ips` JSON crash reports from iOS, macOS, Catalyst, and simulator targets, plus legacy text `.crash` reports, and produces a structured report that explains the likely root-cause path in plain language.

The analyzer is based on Apple's crash report documentation:

- [Diagnosing issues using crash reports and device logs](https://developer.apple.com/documentation/xcode/diagnosing-issues-using-crash-reports-and-device-logs)
- [Analyzing a crash report](https://developer.apple.com/documentation/xcode/analyzing-a-crash-report)
- [Examining the fields in a crash report](https://developer.apple.com/documentation/xcode/examining-the-fields-in-a-crash-report)
- [Interpreting the JSON format of a crash report](https://developer.apple.com/documentation/xcode/interpreting-the-json-format-of-a-crash-report)
- [Identifying the cause of common crashes](https://developer.apple.com/documentation/xcode/identifying-the-cause-of-common-crashes)

## Features

- Upload or drag in `.ips` and `.crash` reports.
- Parse Apple's two-object IPS JSON format and reject non-crash IPS logs.
- Render summary, environment, exception and termination fields, diagnostics, crashed thread frames, binary images, and raw JSON.
- Explain likely root cause using documented clues such as Last Exception Backtrace, VM Region Info, exception notes, triggered thread, and thread-state registers.
- Analyze all local reports from the command line and write Markdown/JSON output.
- Run without runtime dependencies; the app uses browser ES modules and Node.js built-ins.

## Quick Start

```sh
npm start
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). The app lists sanitized examples from `examples/` and any private `.ips` or `.crash` reports you place in the project root.

Run checks:

```sh
npm run ci
```

Analyze local reports:

```sh
npm run analyze
```

Generated analysis files are written to `reports/`.

## Privacy Model

Crash reports can contain device models, OS builds, process paths, bundle identifiers, incident identifiers, stack traces, and diagnostic messages. This repo intentionally ignores real `.ips` and `.crash` files, plus generated `reports/` output. Only sanitized demo reports under `examples/` are committed.

Before making a fork or deployment public, review any added fixtures and generated artifacts for private paths, identifiers, proprietary symbols, or user data.

## Report Interpretation

The Root Cause Guide separates the crash mechanism from the likely cause. For example, `EXC_CRASH (SIGABRT)` usually describes how the process quit, while a Last Exception Backtrace may identify the API path that threw an uncaught language exception. For memory faults, the guide highlights exception subtype, VM Region Info, and CPU registers such as `pc`, `lr`, `far`, and `esr`.

This tool is a triage aid. It does not replace symbolication, Xcode debugging, sanitizers, device logs, or careful comparison across multiple reports.

## Development

```sh
npm test
npm run check
npm run analyze
```

The parser lives in `src/crashParser.js`. The browser harness lives in `index.html`, `src/app.js`, and `src/styles.css`. The local server is `scripts/server.js`.

## License

MIT. See [LICENSE](LICENSE).
