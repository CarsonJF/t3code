# Tot themes

A Tot's `theme.css` is applied to that Tot's conversation only. Web and desktop run the whole sheet through a scoped stylesheet. Mobile has no CSS engine, so it reads a small, fixed set of colour tokens out of the same file. A theme does not have to use them: without tokens, mobile keeps the app's colours.

## Tokens

Write tokens as custom properties in a `:root` block. They are ordinary CSS on web, so the same file still styles everything else there.

```css
:root {
  --tot-bg: #0b0a10;
  --tot-surface: #1b1724;
  --tot-accent: #e8679f;
  --tot-text: #f4eef7;
  --tot-muted: #a99aae;
  --tot-code-bg: #241f2d;
  --tot-border: #342c40;
}
```

| token           | what mobile paints                                    | fallback when absent          |
| --------------- | ----------------------------------------------------- | ----------------------------- |
| `--tot-bg`      | conversation canvas and the Tot identity band         | the app's screen colour       |
| `--tot-surface` | user message bubbles, the band's badge, composer host | the app's own surface colours |
| `--tot-accent`  | links, including links inside user messages           | the app's link colour         |
| `--tot-text`    | message text, code text and the Tot's name            | the app's text colours        |
| `--tot-muted`   | muted text in messages and the band's state label     | the app's muted text          |
| `--tot-code-bg` | code block backgrounds                                | the app's code background     |
| `--tot-border`  | code block borders, composer border, band underline   | the app's border colours      |

Mobile does not theme navigation chrome, the sidebar, other threads, or the effect layer. Tokens apply in both light and dark appearance: write one set that reads on the background you chose. Set `--tot-bg` with `--tot-text`, and `--tot-surface` with `--tot-text` too; every missing token keeps the app's colour, which may not read on your background.

## Rules

The parser in `packages/shared/src/totThemeTokens.ts` is a declaration scan, not a CSS parser:

- Only the seven `--tot-*` names above count. Another `--tot-*` name is reported and ignored.
- Comments are skipped, so `/* --tot-bg: #fff; */` sets nothing.
- Declarations may appear anywhere in the sheet; the last one wins. Do not use them under an appearance selector: mobile does not know which one matched.
- Values must be one plain colour: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`, `hsl()`/`hsla()` in comma form, or a basic named colour such as `red` or `transparent`.
- `!important`, `var()`, `url()`, `expression()`, and CSS escapes are refused.
- A refused declaration is left out; the rest of the theme still loads.

See `TotThemeEffect.md` for the sandboxed effect layer.
