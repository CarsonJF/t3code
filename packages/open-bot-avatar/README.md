# open-bot-avatar (vendored)

[open-bot-avatar](https://github.com/DominikScholz/open-bot-avatar) by Dominik Scholz, MIT licensed (see [LICENSE](LICENSE)). It draws a Tot's face when the Tot's avatar style is `open-bot`.

- Source: the private mirror `CarsonJF/open-bot-avatar-fork`, tag `v0.4.0-cardinal.3`: upstream `323ce6a` (npm `open-bot-avatar@0.4.0`) with two open upstream pull requests merged on top:
  - [#31](https://github.com/DominikScholz/open-bot-avatar/pull/31) "Add opt-in canvas materials and a glass finish" by K4Lok (MIT): the `CanvasMaterial` interface and `materials/fluffy`, `materials/glass`.
  - [#32](https://github.com/DominikScholz/open-bot-avatar/pull/32) "Soft: the soft-shape subsurface material" by yqecea (MIT): the soft finish and the Hark roster.
  - The merge resolution makes soft a `CanvasMaterial` (`materials/soft`) next to fluffy and glass, instead of #32's `material: 'soft'` string. Upstream may land either PR differently.
- `lib/` is the package's own `tsc -p packages/core/tsconfig.build.json` output at that tag, after `pnpm check` passed there, with source maps removed. It is `lib/` because `packages/*/dist` is gitignored.
- `prompt.js` is the mirror's `prompt.md` as a string: the design prompt upstream publishes at <https://dominikscholz.github.io/open-bot-avatar/prompt.md> (from `skills/generate-avatar/references/system-prompt.md`). T3 never fetches the URL; it uses this copy.
- `gallery.js` is upstream's `gallery/*.json` definitions (not `colors.json`), gathered into one module.

The build is vendored rather than its TypeScript source because the source does not compile under this repo's stricter compiler options. To update, tag a new commit on the mirror, run `pnpm check` there, and replace `lib/`, `gallery.js` and `prompt.js`.
