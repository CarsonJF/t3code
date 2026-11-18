export interface OpenCodeStepTokens {
  readonly input: number;
  readonly output: number;
  readonly cache: { readonly read: number; readonly write: number };
}

export interface OpenCodeStepTrace {
  readonly sessionId: string;
  readonly model: string;
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly instructionSeq: number | undefined;
  readonly eventSeq: number;
}

/**
 * OpenCode persists `instruction_state.through_seq`, but its event stream does
 * not carry it on `session.step.ended` (checked through 2.3.2 and protocol
 * 2.0.28). Accept the shapes a newer event could use so the trace grows into it.
 */
export const openCodeInstructionSeq = (data: unknown): number | undefined => {
  if (typeof data !== "object" || data === null) return undefined;
  const value =
    (
      data as {
        readonly instruction_state?: { readonly through_seq?: unknown };
        readonly instructionState?: { readonly throughSeq?: unknown };
      }
    ).instruction_state?.through_seq ??
    (data as { readonly instructionState?: { readonly throughSeq?: unknown } }).instructionState
      ?.throughSeq;
  return typeof value === "number" ? value : undefined;
};

/** The one-line per-step token trace used to attribute prompt-cache misses. */
export const openCodeStepTrace = (input: {
  readonly sessionId: string;
  readonly model: string;
  readonly tokens: OpenCodeStepTokens;
  readonly eventSeq: number;
  readonly data: unknown;
}): OpenCodeStepTrace => ({
  sessionId: input.sessionId,
  model: input.model,
  input: input.tokens.input,
  cacheRead: input.tokens.cache.read,
  cacheWrite: input.tokens.cache.write,
  output: input.tokens.output,
  instructionSeq: openCodeInstructionSeq(input.data),
  eventSeq: input.eventSeq,
});
