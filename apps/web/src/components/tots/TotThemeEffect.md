# Tot theme effects

A Tot's `theme.effect` is a JavaScript program that draws over the conversation area while that Tot's thread is open. It runs in an `<iframe sandbox="allow-scripts">` with an opaque origin and this CSP:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:
```

It cannot read the app, its storage or cookies, navigate, open windows, or reach the network. Images work only as `data:` URLs. The frame takes no input: clicks, selection and scrolling go to the conversation underneath. Users can turn every effect off in Settings → Appearance → Theme effects.

## Limits

- At most 20,000 characters, stored with the Tot.
- No `eval` or `new Function`, and no external scripts.
- The frame is torn down when the user leaves the thread or the effect changes.
- Not shown on mobile.

## API

Before your script runs, the page has a full-size `<canvas id="fx">` already sized for the device pixel ratio, and a global `fx`:

- `fx.canvas`: the canvas. Its backing size is `state.width * state.dpr` by `state.height * state.dpr`, resized for you on `resize`. Scale your context with `ctx.setTransform(fx.state.dpr, 0, 0, fx.state.dpr, 0, 0)` after each resize.
- `fx.state`: `{ width, height, dpr, reduced, hidden }`, kept current.
- `fx.on(type, handler)`: called with each message of that type.

The host sends at most one message of each type per animation frame:

| type         | fields                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pointer`    | `x`, `y` in CSS px from the frame's top left; `inside: false` on leaving                                                                           |
| `resize`     | `width`, `height` in CSS px, `dpr`                                                                                                                 |
| `motion`     | `reduced`: the user prefers reduced motion                                                                                                         |
| `visibility` | `hidden`: the app is in the background                                                                                                             |
| `context`    | `usedTokens`, `maxTokens`, `usedPercentage` (`null` when unknown), `working`, `phase` (`"disconnected"`, `"connecting"`, `"ready"` or `"running"`) |

Pointer messages arrive only while the pointer moves over the conversation area. A `context` message arrives once after the frame loads and then only when one of its values changes, never once per frame. It carries numbers and the phase name only: never message text, prompts or tool output.

Draw nothing while idle: run `requestAnimationFrame` only while something is animating, stop when `hidden` is true, and keep motion minimal (or skip it) when `reduced` is true.

## Example

A dot that follows the pointer:

```js
const ctx = fx.canvas.getContext("2d");
const draw = (m) => {
  ctx.setTransform(fx.state.dpr, 0, 0, fx.state.dpr, 0, 0);
  ctx.clearRect(0, 0, fx.state.width, fx.state.height);
  if (!m.inside) return;
  ctx.fillStyle = "hotpink";
  ctx.beginPath();
  ctx.arc(m.x, m.y, 6, 0, Math.PI * 2);
  ctx.fill();
};
fx.on("pointer", draw);
```

Snow that gets heavier as the context window fills:

```js
// 0 at an empty window, 1 when it is full.
let intensity = 0;

fx.on("context", (m) => {
  intensity = (m.usedPercentage ?? 0) / 100;
});

// Scale how many flakes you spawn, or how fast they fall, by `intensity`.
```
