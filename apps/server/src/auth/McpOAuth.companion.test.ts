import { it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { HttpServerRequest } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as CompanionGrants from "../companions/CompanionGrants.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as EnvironmentAuth from "./EnvironmentAuth.ts";
import * as McpOAuth from "./McpOAuth.ts";

const request = (remoteAddress: string, headers: Record<string, string>) =>
  ({
    headers,
    source: { socket: { remoteAddress } },
  }) as unknown as HttpServerRequest.HttpServerRequest;

const authenticator = Effect.gen(function* () {
  const context = yield* Layer.build(
    McpOAuth.layerMcpClientAuthenticator.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(EnvironmentAuth.EnvironmentAuth)({
            authenticateMcpClient: () =>
              Effect.succeed({
                sessionId: AuthSessionId.make("companion-session"),
                label: "Companion: Demo",
                access: "approval-required",
                peerLink: false,
              }),
          }),
          Layer.mock(ServerEnvironment.ServerEnvironment)({
            getEnvironmentId: Effect.succeed(EnvironmentId.make("env-1")),
          }),
          Layer.succeed(CompanionGrants.CompanionGrants, {
            issue: () => Effect.die("unused"),
            revoke: () => Effect.void,
            retain: () => Effect.void,
            status: () => Effect.succeed(null),
            exchange: () => Effect.die("unused"),
            companionForSession: (sessionId) =>
              Effect.succeed(sessionId === "companion-session" ? "demo" : undefined),
            changes: Stream.empty,
          }),
        ),
      ),
    ),
  );
  return Context.get(context, McpHttpServer.McpClientAuthenticator);
});

describe("MCP sign-in with a companion grant", () => {
  it.effect("records the companion as the caller from this machine", () =>
    Effect.gen(function* () {
      const auth = yield* authenticator;
      const scope = yield* auth.authenticate(request("127.0.0.1", { host: "127.0.0.1:3773" }));
      expect(scope?.client?.companionId).toBe("demo");
      expect(scope?.client?.access).toBe("approval-required");
    }).pipe(Effect.scoped),
  );

  it.effect("is no credential from anywhere else", () =>
    Effect.gen(function* () {
      const auth = yield* authenticator;
      expect(
        yield* auth.authenticate(request("100.64.0.9", { host: "127.0.0.1:3773" })),
      ).toBeUndefined();
      expect(
        yield* auth.authenticate(
          request("127.0.0.1", { host: "box.ts.net", "x-forwarded-for": "100.64.0.9" }),
        ),
      ).toBeUndefined();
    }).pipe(Effect.scoped),
  );
});
