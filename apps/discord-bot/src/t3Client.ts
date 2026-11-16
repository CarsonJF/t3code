// @effect-diagnostics extendsNativeError:off - Transport errors are plain locals of a standalone client.
/** The MCP protocol revision this client speaks, matching the server's transport. */
const MCP_PROTOCOL_VERSION = "2025-06-18";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface T3McpClientOptions {
  /** The environment's `/mcp` URL. */
  readonly url: string;
  /** A bearer token, normally the 30-day MCP client session from `npm run mint-token`. */
  readonly token: string;
  readonly clientName?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

class T3McpError extends Error {
  readonly detail: { readonly tool?: string; readonly status?: number; readonly cause?: unknown };

  constructor(
    message: string,
    detail: { readonly tool?: string; readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(message, detail.cause === undefined ? undefined : { cause: detail.cause });
    this.name = "T3McpError";
    this.detail = detail;
  }
}

/** A tool refused the call; the message is the server's own explanation. */
class T3ToolError extends T3McpError {
  readonly tool: string;

  constructor(tool: string, message: string) {
    super(message, { tool });
    this.name = "T3ToolError";
    this.tool = tool;
  }
}

export interface T3ToolResult {
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
}

interface JsonRpcEnvelope {
  readonly id?: unknown;
  readonly method?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

const asEnvelope = (value: unknown): JsonRpcEnvelope | null =>
  typeof value === "object" && value !== null ? (value as JsonRpcEnvelope) : null;

const parseSse = (body: string): ReadonlyArray<unknown> => {
  const payloads: Array<unknown> = [];
  for (const event of body.split(/(?:\r\n|\r(?!\n)|\n){2}/u)) {
    const data = event
      .split(/\r\n|\r|\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n");
    if (data.length === 0) continue;
    payloads.push(JSON.parse(data) as unknown);
  }
  return payloads;
};

const failureText = (result: T3ToolResult): string => {
  const structured = result.structuredContent;
  if (typeof structured === "object" && structured !== null && "error" in structured) {
    const error = (structured as { readonly error?: unknown }).error;
    if (typeof error === "object" && error !== null && "message" in error) {
      const message = (error as { readonly message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) return message;
    }
  }
  const text = result.content?.find((part) => part.type === "text")?.text;
  return text !== undefined && text.length > 0 ? text : "The tool call failed.";
};

export interface T3Client {
  /** Calls one MCP tool and returns its structured result. */
  readonly call: <A>(tool: string, args: Readonly<Record<string, unknown>>) => Promise<A>;
  readonly close: () => Promise<void>;
}

/**
 * The JSON-RPC handshake over the environment's Streamable HTTP endpoint:
 * initialize once, carry `mcp-session-id` and the negotiated protocol version,
 * and read either a JSON body or an SSE stream back.
 */
export const createT3Client = (options: T3McpClientOptions): T3Client => {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let sessionId: string | null = null;
  let protocolVersion: string | null = null;
  let nextId = 0;
  let handshake: Promise<void> | null = null;

  const headers = (): Record<string, string> => ({
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${options.token}`,
    ...(sessionId === null ? {} : { "mcp-session-id": sessionId }),
    ...(protocolVersion === null ? {} : { "mcp-protocol-version": protocolVersion }),
  });

  const readResponse = async (response: Response): Promise<ReadonlyArray<unknown>> => {
    if (response.status === 202 || response.status === 204) return [];
    const mediaType = (response.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    const body = await response.text();
    if (body.trim().length === 0) return [];
    return mediaType === "text/event-stream" ? parseSse(body) : [JSON.parse(body) as unknown];
  };

  const send = async (message: unknown): Promise<ReadonlyArray<unknown>> => {
    let response: Response;
    try {
      response = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers() },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new T3McpError(`Could not reach the T3 MCP endpoint at ${options.url}.`, { cause });
    }
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new T3McpError(
        response.status === 401 || response.status === 403
          ? `The T3 MCP endpoint rejected the token (HTTP ${response.status}). Mint a new one with npm run mint-token.`
          : `The T3 MCP endpoint answered HTTP ${response.status}.`,
        { status: response.status },
      );
    }
    const payloads = await readResponse(response);
    return payloads;
  };

  const request = async (method: string, params: unknown): Promise<JsonRpcEnvelope> => {
    const id = `discord-tot-bridge-${nextId}`;
    nextId += 1;
    const payloads = await send({ jsonrpc: "2.0", id, method, params });
    for (const payload of payloads) {
      const envelope = asEnvelope(payload);
      if (envelope === null) continue;
      // A server-initiated request (a ping) is answered so the call can finish.
      if (envelope.method === "ping") {
        await send({ jsonrpc: "2.0", id: envelope.id, result: {} });
        continue;
      }
      if (envelope.id !== id) continue;
      if (envelope.error !== undefined) {
        throw new T3McpError(`T3 MCP ${method} failed: ${JSON.stringify(envelope.error)}`);
      }
      return envelope;
    }
    throw new T3McpError(`T3 MCP ${method} returned no response.`);
  };

  const initialize = async (): Promise<void> => {
    const envelope = await request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: options.clientName ?? "discord-tot-bridge", version: "0.0.0" },
    });
    const result = asEnvelope(envelope.result);
    const negotiated =
      typeof result === "object" && result !== null && "protocolVersion" in result
        ? (result as { readonly protocolVersion?: unknown }).protocolVersion
        : undefined;
    if (typeof negotiated === "string" && negotiated.length > 0) protocolVersion = negotiated;
    await send({ jsonrpc: "2.0", method: "notifications/initialized" });
  };

  const ready = async (): Promise<void> => {
    handshake ??= initialize().catch((cause: unknown) => {
      handshake = null;
      throw cause instanceof T3McpError
        ? cause
        : new T3McpError("Could not open an MCP session.", { cause });
    });
    await handshake;
  };

  return {
    call: async <A>(tool: string, args: Readonly<Record<string, unknown>>): Promise<A> => {
      await ready();
      const envelope = await request("tools/call", { name: tool, arguments: args });
      const result = asEnvelope(envelope.result);
      if (result === null) throw new T3McpError(`T3 MCP ${tool} returned no result.`, { tool });
      const toolResult = result as T3ToolResult;
      if (toolResult.isError === true) throw new T3ToolError(tool, failureText(toolResult));
      return toolResult.structuredContent as A;
    },
    close: async () => {
      if (sessionId === null) return;
      const current = sessionId;
      sessionId = null;
      await doFetch(options.url, {
        method: "DELETE",
        headers: { authorization: `Bearer ${options.token}`, "mcp-session-id": current },
      })
        .then(async (response) => {
          await response.body?.cancel();
        })
        .catch(() => undefined);
    },
  };
};
