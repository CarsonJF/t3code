import { TOT_MEMORY_MAX_FILES, TotError, type TotId, type TotMemoryFile } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

/** Whether a client-supplied path stays inside a Tot's memory: `MEMORY.md` or `memory/...`. */
const isTotMemoryPath = (candidate: string): boolean => {
  if (candidate === "MEMORY.md") return true;
  if (!candidate.startsWith("memory/") || candidate.includes("\\") || candidate.includes("\0")) {
    return false;
  }
  return candidate.split("/").every((part) => part !== "" && part !== "." && part !== "..");
};

/**
 * A Tot's memory files, or with `id: null` the `MEMORY.md` every Tot shares.
 * Only text the Tot itself keeps is read; anything else in its folder is left alone.
 */
export const readTotMemory = Effect.fn("totMemory.read")(function* (id: TotId | null) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const root =
    id === null ? path.resolve(config.baseDir, "tots") : path.resolve(config.baseDir, "tots", id);
  const relative: string[] = ["MEMORY.md"];
  if (id !== null) {
    const nested = yield* fileSystem
      .readDirectory(path.join(root, "memory"), { recursive: true })
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const entry of nested) relative.push(`memory/${entry.split(path.sep).join("/")}`);
  }
  const files: TotMemoryFile[] = [];
  for (const candidate of relative.slice(0, TOT_MEMORY_MAX_FILES)) {
    if (!isTotMemoryPath(candidate)) continue;
    const content = yield* fileSystem.readFileString(path.join(root, candidate)).pipe(
      Effect.map((text): string | null => text),
      Effect.orElseSucceed((): string | null => null),
    );
    if (content !== null && content.length <= 262_144) files.push({ path: candidate, content });
  }
  return files;
});

/** Writes memory files into a Tot's folder, which must already exist. */
export const writeTotMemory = Effect.fn("totMemory.write")(function* (
  id: TotId,
  files: ReadonlyArray<TotMemoryFile>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const root = path.resolve(config.baseDir, "tots", id);
  for (const file of files) {
    if (!isTotMemoryPath(file.path)) {
      return yield* new TotError({ message: `"${file.path}" is not a memory file.` });
    }
    const target = path.join(root, ...file.path.split("/"));
    yield* fileSystem.makeDirectory(path.dirname(target), { recursive: true }).pipe(
      Effect.andThen(fileSystem.writeFileString(target, file.content)),
      Effect.mapError(() => new TotError({ message: "Memory could not be saved." })),
    );
  }
});
