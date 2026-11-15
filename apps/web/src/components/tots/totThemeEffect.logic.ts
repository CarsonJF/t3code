export const EFFECT_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:";

const PRELUDE = `(() => {
  const canvas = document.getElementById("fx");
  const handlers = {};
  const state = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1, reduced: false, hidden: false };
  const size = () => {
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
  };
  size();
  addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || !message || typeof message.type !== "string") return;
    if (message.type === "resize") {
      Object.assign(state, { width: message.width, height: message.height, dpr: message.dpr });
      size();
    } else if (message.type === "motion") state.reduced = message.reduced;
    else if (message.type === "visibility") state.hidden = message.hidden;
    for (const handler of handlers[message.type] ?? []) {
      try { handler(message); } catch (error) { console.error(error); }
    }
  });
  window.fx = { canvas, state, on: (type, handler) => { (handlers[type] ??= []).push(handler); } };
})();`;

// The script is inlined, so keep it from closing its own <script> element early.
const escapeInlineScript = (script: string) =>
  script.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

export function buildEffectDocument(script: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${EFFECT_CONTENT_SECURITY_POLICY}"><style>html,body{margin:0;height:100%;overflow:hidden;background:transparent}#fx{position:fixed;inset:0;width:100%;height:100%}</style></head><body><canvas id="fx"></canvas><script>${PRELUDE}</script><script>${escapeInlineScript(script)}</script></body></html>`;
}
