import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as CompanionGrants from "./CompanionGrants.ts";

export const COMPANION_TOKEN_ROUTE = "/api/companions/v1/token";

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

const TokenBody = Schema.Struct({
  grant_type: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
});
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(TokenBody));

const refusal = (status: number, error: string, description: string) =>
  HttpServerResponse.jsonUnsafe(
    { error, error_description: description },
    { status, headers: NO_STORE },
  );

/** JSON or form-encoded, as OAuth token endpoints take. */
const readBody = (contentType: string | undefined, text: string) => {
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(text);
    return Option.some({
      grant_type: form.get("grant_type") ?? undefined,
      code: form.get("code") ?? undefined,
      refresh_token: form.get("refresh_token") ?? undefined,
    });
  }
  return decodeJson(text);
};

/** Where a companion trades its setup code, then each refresh token, for MCP access. */
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    // Captured here: a route handler only sees the request's own context.
    const grants = yield* CompanionGrants.CompanionGrants;
    return HttpRouter.add(
      "POST",
      COMPANION_TOKEN_ROUTE,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        // A web page may reach loopback; only a companion process is meant to call this.
        if (request.headers.origin !== undefined) {
          return refusal(403, "access_denied", "Browsers cannot exchange companion grants.");
        }
        const text = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
        const body = readBody(request.headers["content-type"], text.slice(0, 8_192));
        if (Option.isNone(body)) {
          return refusal(400, "invalid_request", "Send JSON or a form body.");
        }
        return yield* grants.exchange(request, body.value).pipe(
          Effect.map((result) => HttpServerResponse.jsonUnsafe(result, { headers: NO_STORE })),
          Effect.catch((error) =>
            Effect.succeed(refusal(error.status, error.error, error.description)),
          ),
        );
      }),
    );
  }),
);
