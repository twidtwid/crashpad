# Contributing

Thanks for considering a contribution.

## Local Setup

Use Node.js 20 or newer.

```sh
npm run ci
npm start
```

## Development Guidelines

- Keep the parser dependency-free unless a new dependency materially improves correctness.
- Add tests for new crash patterns before changing analyzer behavior.
- Prefer sanitized fixtures in `examples/`; do not commit real crash reports.
- Preserve user privacy when discussing or sharing crash data.
- Keep UI changes responsive across desktop and tablet viewports.

## Pull Requests

Before opening a pull request, run:

```sh
npm run ci
npm run analyze
```

Include a short explanation of the crash-report pattern or UI flow you changed, plus the Apple documentation or sample evidence behind it when relevant.
