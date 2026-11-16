/** Discord rejects a message body over 2,000 characters; leave room for markers. */
export const BRIDGE_MESSAGE_LIMIT = 1_900;

const FENCE = "```";
const FENCE_OPEN = /^\s*```(.*)$/u;
const FENCE_CLOSE = /^\s*```\s*$/u;

interface TextSegment {
  readonly kind: "text";
  readonly lines: ReadonlyArray<string>;
}

interface CodeSegment {
  readonly kind: "code";
  readonly info: string;
  readonly lines: ReadonlyArray<string>;
}

type Segment = TextSegment | CodeSegment;

const normalize = (text: string): string =>
  text
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+$/gmu, "")
    .trimEnd();

/** Splits at newlines so fenced code stays line-addressable. */
const segmentMarkdown = (text: string): ReadonlyArray<Segment> => {
  const segments: Array<Segment> = [];
  let textLines: Array<string> = [];
  const flushText = () => {
    if (textLines.length > 0) segments.push({ kind: "text", lines: textLines });
    textLines = [];
  };

  const lines = normalize(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const open = FENCE_OPEN.exec(line);
    if (open === null || FENCE_CLOSE.test(line)) {
      textLines.push(line);
      continue;
    }
    flushText();
    const info = open[1]?.trim() ?? "";
    const body: Array<string> = [];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor] ?? "";
      if (FENCE_CLOSE.test(candidate)) break;
      body.push(candidate);
    }
    segments.push({ kind: "code", info, lines: body });
    index = cursor;
  }
  flushText();
  return segments;
};

class ChunkBuilder {
  private lines: Array<string> = [];
  private used = 0;
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get isEmpty(): boolean {
    return this.lines.length === 0;
  }

  tryPushLine(line: string): boolean {
    const added = this.lines.length === 0 ? line.length : line.length + 1;
    if (this.used + added > this.limit) return false;
    this.lines.push(line);
    this.used += added;
    return true;
  }

  pushLine(line: string): void {
    if (!this.tryPushLine(line)) throw new Error("line does not fit the message limit");
  }

  take(): string {
    const text = this.lines.join("\n");
    this.lines = [];
    this.used = 0;
    return text;
  }
}

/** Breaks one oversized line without splitting a surrogate pair. */
const hardSplit = (line: string, limit: number): ReadonlyArray<string> => {
  const pieces: Array<string> = [];
  let current = "";
  for (const character of line) {
    if (current.length + character.length > limit) {
      pieces.push(current);
      current = "";
    }
    current += character;
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
};

const fenceHeader = (info: string): string => (info.length > 0 ? `${FENCE}${info}` : FENCE);

/** A whole code block that fits in one message, or as few messages as its lines allow. */
const emitCodeBlock = (segment: CodeSegment, limit: number, chunks: Array<string>): void => {
  const header = fenceHeader(segment.info);
  const overhead = header.length + FENCE.length;
  let body = segment.lines;
  // An unclosed block in the source still closes on Discord's side.
  while (body.length > 0) {
    const builder = new ChunkBuilder(limit);
    builder.pushLine(header);
    let taken = 0;
    for (const line of body) {
      if (!builder.tryPushLine(line)) break;
      taken += 1;
    }
    if (taken === 0) {
      // One line alone exceeds a message even with the fences: split the line itself.
      const [first, ...rest] = hardSplit(body[0] ?? "", Math.max(1, limit - overhead - 2));
      builder.pushLine(first ?? "");
      chunks.push(`${builder.take()}\n${FENCE}`);
      body = rest.length > 0 ? [rest.join(""), ...body.slice(1)] : body.slice(1);
      continue;
    }
    builder.pushLine(FENCE);
    chunks.push(builder.take());
    body = body.slice(taken);
  }
  if (segment.lines.length === 0) {
    chunks.push(`${header}\n${FENCE}`);
  }
};

/** Splits agent output into Discord-sized messages without cutting a fenced block in half. */
export const splitMessage = (text: string, limit = BRIDGE_MESSAGE_LIMIT): ReadonlyArray<string> => {
  const chunks: Array<string> = [];
  const builder = new ChunkBuilder(limit);
  const flush = () => {
    if (builder.isEmpty) return;
    const chunk = builder.take().trimEnd();
    if (chunk.length > 0) chunks.push(chunk);
  };

  for (const segment of segmentMarkdown(text)) {
    if (segment.kind === "code") {
      flush();
      emitCodeBlock(segment, limit, chunks);
      continue;
    }
    for (const line of segment.lines) {
      if (line.length <= limit) {
        if (!builder.tryPushLine(line)) {
          flush();
          builder.pushLine(line);
        }
        continue;
      }
      flush();
      for (const piece of hardSplit(line, limit)) {
        if (!builder.tryPushLine(piece)) {
          flush();
          builder.pushLine(piece);
        }
      }
    }
  }
  flush();
  return chunks;
};

/**
 * A streaming edit shows the newest text. Discord cannot show more than its
 * limit, and the reader cares about the end of a live answer, not its start.
 */
export const truncateForEdit = (text: string, limit = BRIDGE_MESSAGE_LIMIT): string => {
  if (text.length <= limit) return text;
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  return `…${characters.slice(characters.length - limit + 1).join("")}`;
};
