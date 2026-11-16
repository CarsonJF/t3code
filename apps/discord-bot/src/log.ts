// @effect-diagnostics nodeBuiltinImport:off globalDate:off - The bridge logs JSON lines with plain Node, outside any Effect runtime.
import * as NodeFS from "node:fs";

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly info: (event: string, fields?: LogFields) => void;
  readonly warn: (event: string, fields?: LogFields) => void;
  readonly error: (event: string, fields?: LogFields) => void;
}

export interface LoggerOptions {
  readonly write: (line: string) => void;
  readonly now?: () => number;
  /** Values that must never reach the log, whatever a caller passes. */
  readonly secrets?: ReadonlyArray<string>;
}

const BEARER = /\bBearer\s+[\w.~+/=-]+/gu;

/**
 * Credentials are the only thing redacted: event names are fixed strings and
 * fields are ids, counts and tool names, never message text.
 */
export const redact = (text: string, secrets: ReadonlyArray<string>): string => {
  let result = text.replace(BEARER, "Bearer [redacted]");
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    result = result.split(secret).join("[redacted]");
  }
  return result;
};

const compose =
  (options: LoggerOptions, level: "info" | "warn" | "error", secrets: ReadonlyArray<string>) =>
  (event: string, fields?: LogFields): void => {
    const timestamp = new Date(options.now?.() ?? Date.now()).toISOString();
    const line = JSON.stringify({ at: timestamp, level, event, ...fields });
    options.write(`${redact(line, secrets)}\n`);
  };

export const createLogger = (options: LoggerOptions): Logger => {
  const secrets = (options.secrets ?? []).filter((secret) => secret.length > 0);
  return {
    info: compose(options, "info", secrets),
    warn: compose(options, "warn", secrets),
    error: compose(options, "error", secrets),
  };
};

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Appends JSON lines to a file, created on first write. A failed write stops further ones. */
export const createFileLogger = (
  path: string,
  secrets: ReadonlyArray<string>,
  options: {
    readonly now?: () => number;
    readonly append?: (path: string, line: string) => void;
  } = {},
): Logger => {
  let broken = false;
  const append =
    options.append ?? ((file: string, line: string) => NodeFS.appendFileSync(file, line));
  return createLogger({
    ...(options.now === undefined ? {} : { now: options.now }),
    secrets,
    write: (line) => {
      if (broken) return;
      try {
        append(path, line);
      } catch {
        // A logger that throws cannot report anything; startup already prints to stderr.
        broken = true;
      }
    },
  });
};

export const describeError = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  return String(cause);
};
