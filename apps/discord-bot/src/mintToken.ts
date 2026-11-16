// @effect-diagnostics nodeBuiltinImport:off - PKCE needs node:crypto, outside any Effect runtime.
import * as NodeCrypto from "node:crypto";

/** RFC 8252 loopback redirects: the port is not compared for http, so nothing must listen here. */
export const MINT_REDIRECT_URI = "http://127.0.0.1/callback";
const CLIENT_NAME = "Discord Tot bridge";
const DEFAULT_ACCESS = "full-access";

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export const createPkcePair = (): PkcePair => {
  const verifier = NodeCrypto.randomBytes(32).toString("base64url");
  const challenge = NodeCrypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
};

/**
 * Accepts what `t3 auth pairing create` prints in each of its forms: the bare
 * credential, its JSON, or a `/pair#token=` link.
 */
export const extractPairingCode = (input: string): string | null => {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { readonly credential?: unknown };
      return typeof parsed.credential === "string" && parsed.credential.length > 0
        ? parsed.credential
        : null;
    } catch {
      return null;
    }
  }
  if (trimmed.includes("#token=") || trimmed.includes("?token=")) {
    const token = trimmed
      .split(/#token=|\\?token=/u)[1]
      ?.split("&", 1)[0]
      ?.trim();
    return token !== undefined && token.length > 0 ? decodeURIComponent(token) : null;
  }
  const single = trimmed.split(/\s+/u)[0];
  return single === undefined || single.length === 0 ? null : single;
};

export interface MintTokenOptions {
  /** The environment's `/mcp` URL; its origin is the OAuth issuer. */
  readonly mcpUrl: string;
  /** Pairing credential from `t3 auth pairing create`. */
  readonly pairingCode: string;
  readonly access?:
    | "read-only"
    | "approval-required"
    | "auto-accept-edits"
    | "auto"
    | "full-access";
  readonly fetchImpl?: typeof fetch;
}

export interface MintedToken {
  readonly accessToken: string;
  readonly expiresInSeconds: number;
  readonly scope: string;
}

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const describeFailure = (body: Record<string, unknown>, status: number): string => {
  const description = body.error_description;
  if (typeof description === "string" && description.length > 0) return description;
  const error = body.error;
  return typeof error === "string" && error.length > 0 ? error : `HTTP ${status}`;
};

/**
 * The documented outside-agent sign-in, done headlessly: register a public
 * PKCE client, spend a pairing code on an authorization code, then exchange it
 * for the 30-day MCP client session token the bridge uses.
 */
export const mintMcpToken = async (options: MintTokenOptions): Promise<MintedToken> => {
  const doFetch = options.fetchImpl ?? fetch;
  const issuer = new URL(options.mcpUrl).origin;
  const resource = new URL(options.mcpUrl).href;
  const access = options.access ?? DEFAULT_ACCESS;
  const pkce = createPkcePair();
  const state = NodeCrypto.randomBytes(16).toString("base64url");

  const registration = await doFetch(`${issuer}/oauth/mcp/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [MINT_REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  });
  const registered = await readJson(registration);
  if (!registration.ok) {
    throw new Error(
      `Registering the client failed: ${describeFailure(registered, registration.status)}`,
    );
  }
  const clientId = registered.client_id;
  if (typeof clientId !== "string" || clientId.length === 0) {
    throw new Error("Registering the client returned no client id.");
  }

  const authorization = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: MINT_REDIRECT_URI,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state,
    resource,
  };
  const decision = await doFetch(`${issuer}/oauth/mcp/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      authorization,
      decision: { _tag: "pairing-code", access, code: options.pairingCode.trim() },
    }),
  });
  const decided = await readJson(decision);
  if (!decision.ok) {
    throw new Error(
      `The pairing code was refused: ${describeFailure(decided, decision.status)}. Codes work once, for five minutes.`,
    );
  }
  const redirectTo = decided.redirectTo;
  if (typeof redirectTo !== "string") {
    throw new Error("Approving the sign-in returned no redirect.");
  }
  const approved = new URL(redirectTo);
  const error = approved.searchParams.get("error");
  if (error !== null) {
    throw new Error(`The sign-in was not approved: ${error}.`);
  }
  const code = approved.searchParams.get("code");
  if (code === null || code.length === 0) {
    throw new Error("The sign-in returned no authorization code.");
  }

  const tokenResponse = await doFetch(`${issuer}/oauth/mcp/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: MINT_REDIRECT_URI,
      client_id: clientId,
      code_verifier: pkce.verifier,
      resource,
    }).toString(),
  });
  const token = await readJson(tokenResponse);
  if (!tokenResponse.ok) {
    throw new Error(`Exchanging the code failed: ${describeFailure(token, tokenResponse.status)}`);
  }
  const accessToken = token.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new Error("The token endpoint returned no access token.");
  }
  return {
    accessToken,
    expiresInSeconds: typeof token.expires_in === "number" ? token.expires_in : 0,
    scope: typeof token.scope === "string" ? token.scope : "",
  };
};

export const formatMintedToken = (minted: MintedToken): string => {
  const days = Math.max(1, Math.round(minted.expiresInSeconds / 86_400));
  return [
    "Add this line to the bridge's .env, then delete this terminal's scrollback:",
    "",
    `T3_MCP_TOKEN=${minted.accessToken}`,
    "",
    `It is a credential for this machine, valid about ${days} days. Revoke it in Settings, Sharing and access.`,
  ].join("\n");
};
