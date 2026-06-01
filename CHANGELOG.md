# Changelog

All notable changes to this project will be documented in this file.

## 0.3.0 - 2026-06-01

- Redesigned the public stats page with elevated metric cards (softer radius, soft shadow, hover lift) and an even eight-card grid; dropped the redundant example-analyses card.
- Rebuilt the Daily Activity chart with a labeled value axis, a dated time axis, a color-keyed legend showing latest values, and consistent line treatment for all series.
- Fixed legend color swatches that previously rendered invisibly, and corrected axis tick scaling so the value axis fits the data.
- Replaced the duplicated first-day metrics with a designed empty state for the chart when there is not yet enough history.
- Added a `VERSION` file.

## 0.1.0 - 2026-06-01

- Added a local browser harness for Apple `.ips` and legacy `.crash` reports.
- Added structured parsing and analysis for exception, termination, diagnostics, crashed thread, binary images, symbolication status, and root-cause guide output.
- Added folder-level Markdown and JSON analysis generation.
- Added a sanitized QLThumbnail example for public-safe testing and demos.
- Added privacy policy page, repository links, and an explicit Forget Report control for ephemeral browser-local file imports.
- Added public, privacy-preserving aggregate stats for visits, analyses, parse failures, and local actions.
- Added container deployment defaults for hosted environments.
- Added a Sprite deployment runbook for the public CrashPad instance.
