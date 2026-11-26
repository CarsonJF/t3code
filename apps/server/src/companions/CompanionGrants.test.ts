import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { it } from "@effect/vitest";
import { AuthSessionId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import type { HttpServerRequest } from "effect/http";
import { describe, expect } from "vite-plus/test";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as CompanionGrants from "./CompanionGrants.ts";

const request = (
  remoteAddress: string,
  headers: Record<string, string> = { host: "127.0.0.1:3773" },
) =>
  ({
    headers,
    source: { socket: { remoteAddress } },
  }) as unknown as HttpServerRequest.HttpServerRequest;
const local = request("127.0.0.1");

interface Issued {
  readonly sessionId: string;
  readonly ttl: Duration.Duration | undefined;
  readonly access: string;
}

const setup = Effect.fn("test.grants.setup")(function* () {
  const issued = yield* Ref.make<ReadonlyArray<Issued>>([]);
  const revoked = yield* Ref.make<ReadonlyArray<string>>([]);
  const secrets = new Map<string, Uint8Array>();
  const auth = Layer.mock(EnvironmentAuth.EnvironmentAuth)({
    issueMcpClientSession: (input) =>
      Ref.updateAndGet(issued, (current) => [
        ...current,
        { sessionId: `session-${current.length + 1}`, ttl: input.ttl, access: input.access },
      ]).pipe(
        Effect.map((current) => ({
          sessionId: AuthSessionId.make(`session-${current.length}`),
          token: `access-${current.length}`,
          expiresAt: DateTime.makeUnsafe(0),
        })),
      ),
    revokeSession: (sessionId) =>
      Ref.update(revoked, (current) => [...current, sessionId]).pipe(Effect.as(true)),
  });
  const store = Layer.mock(ServerSecretStore.ServerSecretStore)({
    get: (name) => Effect.succeed(Option.fromNullishOr(secrets.get(name))),
    set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
  });
  const context = yield* Layer.build(
    CompanionGrants.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          auth,
          store,
          ServerSettings.ServerSettingsService.layerTest({}, {
            organization: "Example",
            limits: { maxRuntimeMode: "auto-accept-edits" },
          } as never),
          NodeCrypto.layer,
        ),
      ),
    ),
  );
  return {
    grants: Context.get(context, CompanionGrants.CompanionGrants),
    issued: Ref.get(issued),
    revoked: Ref.get(revoked),
  };
});

describe("CompanionGrants", () => {
  it.effect("trades a setup code once for short MCP access and a rotating refresh token", () =>
    Effect.gen(function* () {
      const { grants, issued, revoked } = yield* setup();
      const { setupCode } = yield* grants.issue({
        companionId: "demo",
        label: "Companion: Demo",
        access: "approval-required",
      });
      expect(setupCode).toMatch(/^t3cs_/);
      const first = yield* grants.exchange(local, { grant_type: "setup_code", code: setupCode });
      expect(first).toMatchObject({
        access_token: "access-1",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token_expires_in: 30 * 24 * 3600,
        companion_id: "demo",
      });
      expect(first.scope).not.toContain("access:write");
      expect((yield* issued)[0]?.ttl).toEqual(CompanionGrants.ACCESS_TOKEN_TTL);
      expect(yield* grants.companionForSession("session-1")).toBe("demo");
      // The setup code is spent.
      const again = yield* grants
        .exchange(local, { grant_type: "setup_code", code: setupCode })
        .pipe(Effect.flip);
      expect(again.error).toBe("invalid_grant");

      const second = yield* grants.exchange(local, {
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
      });
      expect(second.refresh_token).not.toBe(first.refresh_token);
      expect(yield* revoked).toEqual(["session-1"]);
      expect(yield* grants.companionForSession("session-2")).toBe("demo");
      const status = yield* grants.status("demo");
      expect(status?.connectedAt).not.toBeNull();
      expect(status?.lastRefreshedAt).not.toBeNull();
    }),
  );

  it.effect("ends the grant when a rotated-away refresh token comes back", () =>
    Effect.gen(function* () {
      const { grants } = yield* setup();
      const { setupCode } = yield* grants.issue({
        companionId: "demo",
        label: "x",
        access: "read-only",
      });
      const first = yield* grants.exchange(local, { grant_type: "setup_code", code: setupCode });
      yield* grants.exchange(local, {
        grant_type: "refresh_token",
        refresh_token: first.refresh_token,
      });
      const replay = yield* grants
        .exchange(local, { grant_type: "refresh_token", refresh_token: first.refresh_token })
        .pipe(Effect.flip);
      expect(replay.description).toMatch(/revoked/);
      expect(yield* grants.status("demo")).toBeNull();
    }),
  );

  it.effect("lets setup codes and idle refresh tokens lapse", () =>
    Effect.gen(function* () {
      const { grants } = yield* setup();
      const lapsed = yield* grants.issue({ companionId: "demo", label: "x", access: "read-only" });
      yield* TestClock.adjust(Duration.minutes(11));
      const late = yield* grants
        .exchange(local, { grant_type: "setup_code", code: lapsed.setupCode })
        .pipe(Effect.flip);
      expect(late.error).toBe("invalid_grant");

      const fresh = yield* grants.issue({ companionId: "demo", label: "x", access: "read-only" });
      const tokens = yield* grants.exchange(local, {
        grant_type: "setup_code",
        code: fresh.setupCode,
      });
      yield* TestClock.adjust(Duration.days(31));
      const idle = yield* grants
        .exchange(local, { grant_type: "refresh_token", refresh_token: tokens.refresh_token })
        .pipe(Effect.flip);
      expect(idle.error).toBe("invalid_grant");
    }),
  );

  it.effect("revokes, and drops grants of companions no longer registered", () =>
    Effect.gen(function* () {
      const { grants, revoked } = yield* setup();
      const a = yield* grants.issue({ companionId: "a", label: "a", access: "read-only" });
      yield* grants.exchange(local, { grant_type: "setup_code", code: a.setupCode });
      yield* grants.issue({ companionId: "b", label: "b", access: "read-only" });
      yield* grants.revoke("a");
      expect(yield* revoked).toEqual(["session-1"]);
      expect(yield* grants.companionForSession("session-1")).toBeUndefined();
      yield* grants.retain(new Set());
      expect(yield* grants.status("b")).toBeNull();
    }),
  );

  it.effect("caps access at the managed policy's ceiling", () =>
    Effect.gen(function* () {
      const { grants, issued } = yield* setup();
      const { setupCode } = yield* grants.issue({
        companionId: "demo",
        label: "x",
        access: "full-access",
      });
      yield* grants.exchange(local, { grant_type: "setup_code", code: setupCode });
      expect((yield* issued)[0]?.access).toBe("auto-accept-edits");
    }),
  );

  it.effect("accepts exchanges only from this machine, never through a proxy", () =>
    Effect.gen(function* () {
      const { grants } = yield* setup();
      const { setupCode } = yield* grants.issue({
        companionId: "demo",
        label: "x",
        access: "read-only",
      });
      for (const from of [
        request("100.101.102.103", { host: "127.0.0.1:3773" }),
        request("127.0.0.1", { host: "machine.tailnet.ts.net", "x-forwarded-for": "100.1.2.3" }),
        request("127.0.0.1", { host: "box.example.com" }),
      ]) {
        const refused = yield* grants
          .exchange(from, { grant_type: "setup_code", code: setupCode })
          .pipe(Effect.flip);
        expect(refused.status).toBe(403);
      }
      // Still unspent: the refused attempts never reached it.
      const ok = yield* grants.exchange(local, { grant_type: "setup_code", code: setupCode });
      expect(ok.access_token).toBe("access-1");
    }),
  );
});

describe("clampAccess", () => {
  it("leaves read-only and anything under the ceiling alone", () => {
    expect(CompanionGrants.clampAccess("read-only", "approval-required")).toBe("read-only");
    expect(CompanionGrants.clampAccess("auto", undefined)).toBe("auto");
    expect(CompanionGrants.clampAccess("full-access", "auto")).toBe("auto");
  });
});
