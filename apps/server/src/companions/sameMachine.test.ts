import type { HttpServerRequest } from "effect/http";
import { describe, expect, it } from "vite-plus/test";

import { isSameMachineRequest } from "./sameMachine.ts";

const request = (remoteAddress: string | undefined, headers: Record<string, string>) =>
  ({
    headers,
    source: { socket: { remoteAddress } },
  }) as unknown as HttpServerRequest.HttpServerRequest;
const own = () => new Set(["192.168.1.20"]);

describe("isSameMachineRequest", () => {
  it("accepts loopback and this machine's own addresses", () => {
    expect(isSameMachineRequest(request("127.0.0.1", { host: "127.0.0.1:3773" }), own)).toBe(true);
    expect(isSameMachineRequest(request("::1", { host: "[::1]:3773" }), own)).toBe(true);
    expect(isSameMachineRequest(request("::ffff:127.0.0.1", { host: "localhost:3773" }), own)).toBe(
      true,
    );
    expect(isSameMachineRequest(request("192.168.1.20", { host: "192.168.1.20:3773" }), own)).toBe(
      true,
    );
  });

  it("refuses other machines, proxies and public host names", () => {
    expect(isSameMachineRequest(request("192.168.1.30", { host: "192.168.1.20:3773" }), own)).toBe(
      false,
    );
    expect(
      isSameMachineRequest(
        request("127.0.0.1", { host: "127.0.0.1:3773", "x-forwarded-for": "100.64.0.9" }),
        own,
      ),
    ).toBe(false);
    expect(
      isSameMachineRequest(
        request("127.0.0.1", { host: "127.0.0.1", "cf-connecting-ip": "1.2.3.4" }),
        own,
      ),
    ).toBe(false);
    expect(isSameMachineRequest(request("127.0.0.1", { host: "box.tailnet.ts.net" }), own)).toBe(
      false,
    );
    expect(isSameMachineRequest(request(undefined, { host: "127.0.0.1" }), own)).toBe(false);
    expect(isSameMachineRequest(request("127.0.0.1", {}), own)).toBe(false);
  });
});
