import { BRIDGE_MESSAGE_LIMIT, truncateForEdit } from "./split.ts";

export interface StreamEditorOptions {
  readonly limit?: number;
  /** Discord allows about four edits a second per message; stay under it. */
  readonly minIntervalMs?: number;
  readonly now: () => number;
}

/**
 * Turns a stream of growing text into at most one edit per interval. The poll
 * loop calls `next` on every tick, so coalescing costs no timers of its own.
 */
export class StreamEditor {
  private readonly limit: number;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private lastPublished: string | null = null;
  private lastEditAt = Number.NEGATIVE_INFINITY;

  constructor(options: StreamEditorOptions) {
    this.limit = options.limit ?? BRIDGE_MESSAGE_LIMIT;
    this.minIntervalMs = options.minIntervalMs ?? 700;
    this.now = options.now;
  }

  /** The text to edit with, or null when nothing changed or the interval has not passed. */
  next(text: string): string | null {
    const visible = truncateForEdit(text.trim(), this.limit);
    if (visible.length === 0 || visible === this.lastPublished) return null;
    const at = this.now();
    if (at - this.lastEditAt < this.minIntervalMs) return null;
    this.lastPublished = visible;
    this.lastEditAt = at;
    return visible;
  }

  /** The settled body, whatever the interval says. */
  settle(text: string): string {
    const visible = truncateForEdit(text.trim(), this.limit);
    this.lastPublished = visible;
    this.lastEditAt = this.now();
    return visible;
  }

  /** Records text already on screen, so the first real edit is not a repeat of it. */
  seed(text: string): void {
    this.lastPublished = truncateForEdit(text.trim(), this.limit);
  }

  /** Whether this text is already on screen. */
  matches(text: string): boolean {
    return truncateForEdit(text.trim(), this.limit) === this.lastPublished;
  }
}
