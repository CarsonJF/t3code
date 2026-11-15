import { describe, expect, it } from "vite-plus/test";

import { buildEffectDocument, EFFECT_CONTENT_SECURITY_POLICY } from "./totThemeEffect.logic";

describe("buildEffectDocument", () => {
  it("leads with a strict CSP meta that grants no network", () => {
    const html = buildEffectDocument("");
    expect(html.indexOf(`content="${EFFECT_CONTENT_SECURITY_POLICY}"`)).toBeLessThan(
      html.indexOf("<script>"),
    );
    expect(EFFECT_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(EFFECT_CONTENT_SECURITY_POLICY).not.toMatch(/connect-src|https?:|\*/);
  });

  it("keeps the script inside its own element", () => {
    const html = buildEffectDocument('const s = "</SCRIPT><img src=x>"; <!--');
    expect(html.match(/<\/script/gi)).toHaveLength(2);
    expect(html).not.toContain("<!--");
  });
});
