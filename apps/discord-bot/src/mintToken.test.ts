// @effect-diagnostics nodeBuiltinImport:off - The test recomputes the PKCE challenge with node:crypto.
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "vite-plus/test";

import { MINT_REDIRECT_URI, createPkcePair, extractPairingCode } from "./mintToken.ts";

describe("extractPairingCode", () => {
  it("takes the bare credential", () => {
    expect(extractPairingCode("abcd1234efgh5678")).toBe("abcd1234efgh5678");
  });

  it("reads the JSON command output", () => {
    const json = JSON.stringify({
      id: "pair-1",
      credential: "abcd1234efgh5678",
      expiresAt: "2026-01-01T00:05:00Z",
    });

    expect(extractPairingCode(json)).toBe("abcd1234efgh5678");
  });

  it("reads a pairing URL", () => {
    expect(extractPairingCode("http://127.0.0.1:3773/pair#token=abcd1234efgh5678")).toBe(
      "abcd1234efgh5678",
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(extractPairingCode("  abcd1234efgh5678  ")).toBe("abcd1234efgh5678");
  });

  it("returns nothing for an empty or malformed answer", () => {
    expect(extractPairingCode("   ")).toBeNull();
    expect(extractPairingCode("{not json")).toBeNull();
    expect(extractPairingCode('{"id":"pair-1"}')).toBeNull();
  });
});

describe("createPkcePair", () => {
  it("derives an S256 challenge from the verifier", () => {
    const pair = createPkcePair();
    const expected = NodeCrypto.createHash("sha256").update(pair.verifier).digest("base64url");

    expect(pair.challenge).toBe(expected);
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("uses a loopback redirect that needs no listener", () => {
    expect(MINT_REDIRECT_URI.startsWith("http://127.0.0.1/")).toBe(true);
  });
});
