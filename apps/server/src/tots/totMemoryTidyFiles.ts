import { type TotId, TotError } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";

export const BACKUP_FILE = "MEMORY.md.pre-tidy";
const STATE_DIR = ".tidy";

const TidyState = Schema.Struct({
  lastTidyAt: Schema.NullOr(Schema.String),
  tombstones: Schema.Array(Schema.String),
});
export type TidyState = typeof TidyState.Type;
const TidyStateJson = Schema.fromJsonString(TidyState);
const decodeState = Schema.decodeUnknownOption(TidyStateJson);
export const encodeState = Schema.encodeSync(TidyStateJson);

export const totFiles = Effect.fn("TotMemoryTidy.totFiles")(function* (id: TotId) {
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const root = path.resolve(config.baseDir, "tots", id);
  return {
    root,
    memory: path.join(root, "MEMORY.md"),
    backup: path.join(root, BACKUP_FILE),
    state: path.join(root, STATE_DIR, "state.json"),
    lastTidied: path.join(root, STATE_DIR, "last.md"),
    diff: path.join(root, "memory", "tidy", "last.diff"),
    journal: (month: string) => path.join(root, "memory", "journal", `${month}.md`),
    archive: (month: string) => path.join(root, "memory", "log", `${month}.md`),
  };
});

export const readText = (file: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.readFileString(file)),
    Effect.map((text): string | null => text),
    Effect.orElseSucceed((): string | null => null),
  );

export const writeText = Effect.fn("TotMemoryTidy.writeText")(function* (
  file: string,
  text: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
  yield* fileSystem.writeFileString(file, text);
});

export const appendText = Effect.fn("TotMemoryTidy.appendText")(function* (
  file: string,
  text: string,
) {
  const current = (yield* readText(file)) ?? "";
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  yield* writeText(file, `${current}${separator}${text}\n`);
});

export const readTidyState = Effect.fn("TotMemoryTidy.readState")(function* (id: TotId) {
  const files = yield* totFiles(id);
  const text = yield* readText(files.state);
  const decoded = text === null ? undefined : decodeState(text);
  return decoded?._tag === "Some"
    ? decoded.value
    : ({ lastTidyAt: null, tombstones: [] } satisfies TidyState);
});

export const isoMonth = (iso: string) => iso.slice(0, 7);

/** Puts back the `MEMORY.md` the last tidy-up replaced. One tidy-up, one revert. */
export const revertMemoryTidy = Effect.fn("TotMemoryTidy.revert")(
  function* (id: TotId) {
    const fileSystem = yield* FileSystem.FileSystem;
    const files = yield* totFiles(id);
    const backup = yield* readText(files.backup);
    if (backup === null) {
      return yield* new TotError({ message: "There is no memory tidy-up to revert." });
    }
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* writeText(files.memory, backup);
    // What the tidy-up wrote is not what someone deleted, so it must not become a tombstone.
    yield* writeText(files.lastTidied, backup);
    yield* fileSystem.remove(files.backup);
    yield* appendText(
      files.journal(isoMonth(now)),
      `- ${now.slice(0, 16).replace("T", " ")} memory tidy-up reverted.`,
    );
  },
  (effect) =>
    effect.pipe(
      Effect.catchTags({
        PlatformError: () =>
          Effect.fail(new TotError({ message: "The memory tidy-up could not be reverted." })),
      }),
    ),
);
