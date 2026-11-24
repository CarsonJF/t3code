# open-bot-avatar (vendored)

[open-bot-avatar](https://github.com/DominikScholz/open-bot-avatar) by Dominik Scholz, MIT licensed (see [LICENSE](LICENSE)). It draws a Tot's face when the Tot's avatar style is `open-bot`.

- Source: the private mirror `CarsonJF/open-bot-avatar-fork`, tag `v0.4.0-cardinal.1` (upstream commit `323ce6a`, npm `open-bot-avatar@0.4.0`), unmodified.
- `dist/` is upstream's own `tsc -p packages/core/tsconfig.build.json` output at that tag, with source maps removed. It matches the published npm 0.4.0 build file for file.
- `gallery.js` is upstream's `gallery/*.json` definitions (not `colors.json`), gathered into one module.

The build is vendored rather than its TypeScript source because the source does not compile under this repo's stricter compiler options. To update, tag a new commit on the mirror, rebuild there, and replace `dist/` and `gallery.js`.
