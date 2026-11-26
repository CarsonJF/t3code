/**
 * MCP grants for registered companions. Settings issues a short-lived setup code; the companion
 * exchanges it, from this machine only, for a one-hour MCP access token and a refresh token that
 * rotates on every use and lapses after 30 idle days. Nothing issued here outlives its expiry,
 * and removing the companion or revoking the grant ends it.
 */
import {
  AuthMcpClientAccess,
  AuthSessionId,
  type ExternalCompanionGrant,
  ExternalCompanionError,
  mcpClientScopes,
  type RuntimeMode,
} from "@t3tools/contracts";
import { encodeOAuthScope } from "@t3tools/shared/oauthScope";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type { HttpServerRequest } from "effect/http";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { base64UrlEncode, deriveAuthClientMetadata } from "../auth/utils.ts";
import * as ServerSettings from "../serverSettings.ts";
import { isSameMachineRequest } from "./sameMachine.ts";

const SECRET_NAME = "external-companion-grants";
const SETUP_CODE_TTL = Duration.minutes(10);
export const ACCESS_TOKEN_TTL = Duration.hours(1);
const REFRESH_IDLE_TTL = Duration.days(30);
const SETUP_PREFIX = "t3cs_";
const REFRESH_PREFIX = "t3cr_";

const GrantRecord = Schema.Struct({
  companionId: Schema.String,
  label: Schema.String,
  access: AuthMcpClientAccess,
  issuedAt: Schema.Number,
  setupHash: Schema.NullOr(Schema.String),
  refreshHash: Schema.NullOr(Schema.String),
  /** The refresh token rotated away last; presenting it again ends the grant. */
  previousRefreshHash: Schema.NullOr(Schema.String),
  /** When the setup code, or else the refresh token, lapses. */
  expiresAt: Schema.Number,
  connectedAt: Schema.NullOr(Schema.Number),
  lastRefreshedAt: Schema.NullOr(Schema.Number),
  accessSessionId: Schema.NullOr(AuthSessionId),
});
type GrantRecord = typeof GrantRecord.Type;
const GrantFile = Schema.Array(GrantRecord);
const decodeFile = Schema.decodeUnknownOption(Schema.fromJsonString(GrantFile));

export interface CompanionTokenRequest {
  readonly grant_type?: string | undefined;
  readonly code?: string | undefined;
  readonly refresh_token?: string | undefined;
}

export interface CompanionTokenResponse {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly refresh_token_expires_in: number;
  readonly scope: string;
  readonly companion_id: string;
}

export class CompanionGrantError extends Schema.TaggedError<CompanionGrantError>()(
  "CompanionGrantError",
  {
    status: Schema.Number,
    error: Schema.String,
    description: Schema.String,
  },
) {}

const runtimeRank: Record<RuntimeMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
};

/** `access` lowered to a managed policy's ceiling, as an approved MCP client's is. */
export const clampAccess = (
  access: AuthMcpClientAccess,
  ceiling: RuntimeMode | undefined,
): AuthMcpClientAccess =>
  access === "read-only" || ceiling === undefined || runtimeRank[access] <= runtimeRank[ceiling]
    ? access
    : ceiling;

export class CompanionGrants extends Context.Service<
  CompanionGrants,
  {
    readonly issue: (input: {
      readonly companionId: string;
      readonly label: string;
      readonly access: AuthMcpClientAccess;
    }) => Effect.Effect<
      { readonly setupCode: string; readonly expiresAt: number },
      ExternalCompanionError
    >;
    readonly revoke: (companionId: string) => Effect.Effect<void, ExternalCompanionError>;
    /** Ends every grant whose companion is no longer registered. */
    readonly retain: (companionIds: ReadonlySet<string>) => Effect.Effect<void>;
    readonly status: (companionId: string) => Effect.Effect<ExternalCompanionGrant | null>;
    readonly exchange: (
      request: HttpServerRequest.HttpServerRequest,
      body: CompanionTokenRequest,
    ) => Effect.Effect<CompanionTokenResponse, CompanionGrantError>;
    /** The companion an MCP session was issued to, if any. */
    readonly companionForSession: (sessionId: string) => Effect.Effect<string | undefined>;
    readonly changes: Stream.Stream<void>;
  }
>()("t3/companions/CompanionGrants") {}

export const isoAt = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
const iso = (millis: number | null) => (millis === null ? null : isoAt(millis));

const make = Effect.gen(function* () {
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const store = yield* ServerSecretStore.ServerSecretStore;
  const settings = yield* ServerSettings.ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;
  const digester = yield* Digest.Digest;
  const lock = yield* Semaphore.make(1);
  const changed = yield* PubSub.unbounded<void>();

  const initial = yield* store.get(SECRET_NAME).pipe(
    Effect.map((bytes) =>
      Option.isNone(bytes)
        ? []
        : Option.getOrElse(decodeFile(new TextDecoder().decode(bytes.value)), () => []),
    ),
    Effect.orElseSucceed((): ReadonlyArray<GrantRecord> => []),
  );
  const records = yield* Ref.make<ReadonlyArray<GrantRecord>>(initial);

  const hash = (value: string) =>
    digester
      .digest(Digest.sha256, new TextEncoder().encode(value))
      .pipe(Effect.orDie, Effect.map(base64UrlEncode));
  const token = (prefix: string) =>
    random
      .randomBytes(32)
      .pipe(Effect.map((bytes) => prefix + Buffer.from(bytes).toString("base64url")));

  const save = (next: ReadonlyArray<GrantRecord>) =>
    store.set(SECRET_NAME, new TextEncoder().encode(JSON.stringify(next))).pipe(
      Effect.andThen(Ref.set(records, next)),
      Effect.andThen(PubSub.publish(changed, undefined)),
      Effect.mapError(
        () => new ExternalCompanionError({ message: "The grant could not be saved." }),
      ),
    );
  const endSession = (record: GrantRecord | undefined) =>
    record?.accessSessionId == null
      ? Effect.void
      : auth.revokeSession(record.accessSessionId).pipe(Effect.ignore);
  const without = (companionId: string) =>
    Ref.get(records).pipe(
      Effect.flatMap((current) => {
        const ended = current.find((record) => record.companionId === companionId);
        return ended === undefined
          ? Effect.void
          : save(current.filter((record) => record !== ended)).pipe(
              Effect.andThen(endSession(ended)),
            );
      }),
    );

  const issue: CompanionGrants["Service"]["issue"] = Effect.fn("CompanionGrants.issue")(
    function* (input) {
      const setupCode = yield* token(SETUP_PREFIX);
      const now = yield* Clock.currentTimeMillis;
      const expiresAt = now + Duration.toMillis(SETUP_CODE_TTL);
      const access = clampAccess(input.access, settings.managedPolicy?.limits?.maxRuntimeMode);
      const record: GrantRecord = {
        companionId: input.companionId,
        label: input.label,
        access,
        issuedAt: now,
        setupHash: yield* hash(setupCode),
        refreshHash: null,
        previousRefreshHash: null,
        expiresAt,
        connectedAt: null,
        lastRefreshedAt: null,
        accessSessionId: null,
      };
      yield* lock.withPermits(1)(
        without(input.companionId).pipe(
          Effect.andThen(Ref.get(records)),
          Effect.flatMap((current) => save([...current, record])),
        ),
      );
      return { setupCode, expiresAt };
    },
  );

  const revoke: CompanionGrants["Service"]["revoke"] = (companionId) =>
    lock.withPermits(1)(without(companionId));

  const retain: CompanionGrants["Service"]["retain"] = (companionIds) =>
    lock.withPermits(1)(
      Ref.get(records).pipe(
        Effect.flatMap((current) =>
          Effect.forEach(
            current.filter((record) => !companionIds.has(record.companionId)),
            (record) => without(record.companionId),
            { discard: true },
          ),
        ),
        Effect.ignore,
      ),
    );

  const status: CompanionGrants["Service"]["status"] = (companionId) =>
    Ref.get(records).pipe(
      Effect.map((current) => {
        const record = current.find((entry) => entry.companionId === companionId);
        return record === undefined
          ? null
          : {
              access: record.access,
              issuedAt: isoAt(record.issuedAt),
              connectedAt: iso(record.connectedAt),
              lastRefreshedAt: iso(record.lastRefreshedAt),
              expiresAt: isoAt(record.expiresAt),
            };
      }),
    );

  const refuse = (status: number, error: string, description: string) =>
    new CompanionGrantError({ status, error, description });

  const exchange: CompanionGrants["Service"]["exchange"] = Effect.fn("CompanionGrants.exchange")(
    function* (request, body) {
      if (!isSameMachineRequest(request)) {
        return yield* refuse(
          403,
          "access_denied",
          "Companion grants are exchanged only from this machine, without a proxy.",
        );
      }
      const presented =
        body.grant_type === "setup_code"
          ? body.code
          : body.grant_type === "refresh_token"
            ? body.refresh_token
            : undefined;
      if (body.grant_type !== "setup_code" && body.grant_type !== "refresh_token") {
        return yield* refuse(400, "unsupported_grant_type", "Use setup_code or refresh_token.");
      }
      if (presented === undefined || presented === "") {
        return yield* refuse(400, "invalid_request", "The code or refresh_token is missing.");
      }
      const presentedHash = yield* hash(presented);
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const current = yield* Ref.get(records);
          const reused = current.find((record) => record.previousRefreshHash === presentedHash);
          if (reused !== undefined) {
            // A rotated-away token came back: someone else holds a copy. End the grant.
            yield* without(reused.companionId).pipe(Effect.ignore);
            return yield* refuse(400, "invalid_grant", "This grant was revoked.");
          }
          const record = current.find((entry) =>
            body.grant_type === "setup_code"
              ? entry.setupHash === presentedHash
              : entry.refreshHash === presentedHash,
          );
          if (record === undefined || record.expiresAt <= now) {
            return yield* refuse(
              400,
              "invalid_grant",
              "The code or refresh token is invalid or expired.",
            );
          }
          const issued = yield* auth
            .issueMcpClientSession({
              label: record.label,
              access: record.access,
              peerLink: false,
              client: deriveAuthClientMetadata({ request }),
              ttl: ACCESS_TOKEN_TTL,
            })
            .pipe(
              Effect.mapError(() =>
                refuse(500, "server_error", "The session could not be issued."),
              ),
            );
          const refreshToken = yield* token(REFRESH_PREFIX);
          const next: GrantRecord = {
            ...record,
            setupHash: null,
            previousRefreshHash: record.refreshHash,
            refreshHash: yield* hash(refreshToken),
            expiresAt: now + Duration.toMillis(REFRESH_IDLE_TTL),
            connectedAt: record.connectedAt ?? now,
            lastRefreshedAt: body.grant_type === "refresh_token" ? now : record.lastRefreshedAt,
            accessSessionId: issued.sessionId,
          };
          yield* save(current.map((entry) => (entry === record ? next : entry))).pipe(
            Effect.mapError(() => refuse(500, "server_error", "The grant could not be saved.")),
          );
          yield* endSession(record);
          return {
            access_token: issued.token,
            token_type: "Bearer" as const,
            expires_in: Math.floor(Duration.toSeconds(ACCESS_TOKEN_TTL)),
            refresh_token: refreshToken,
            refresh_token_expires_in: Math.floor(Duration.toSeconds(REFRESH_IDLE_TTL)),
            scope: encodeOAuthScope(mcpClientScopes(record.access)),
            companion_id: record.companionId,
          };
        }),
      );
    },
  );

  const companionForSession: CompanionGrants["Service"]["companionForSession"] = (sessionId) =>
    Ref.get(records).pipe(
      Effect.map(
        (current) => current.find((record) => record.accessSessionId === sessionId)?.companionId,
      ),
    );

  return CompanionGrants.of({
    issue,
    revoke,
    retain,
    status,
    exchange,
    companionForSession,
    changes: Stream.fromPubSub(changed),
  });
});

export const layer = Layer.effect(CompanionGrants, make);
