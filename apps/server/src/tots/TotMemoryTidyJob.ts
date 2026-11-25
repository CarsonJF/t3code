import {
  ALWAYS_DENIED_FALLBACK_MODELS,
  type ModelSelection,
  type Tot,
  type TotId,
  TotError,
  parseTotLaunchedThreadId,
} from "@t3tools/contracts";
import { resolveTotMemoryTidyModelSelection } from "@t3tools/shared/serverSettings";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { chooseUsageLimitFallback } from "../orchestration-v2/UsageLimitFallback.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as TotService from "./TotService.ts";
import {
  type TidyState,
  appendText,
  encodeState,
  isoMonth,
  readText,
  readTidyState,
  BACKUP_FILE,
  totFiles,
  writeText,
} from "./totMemoryTidyFiles.ts";
import {
  type ClosedWork,
  enforceMemoryCap,
  journalLine,
  lineDiff,
  memoryTidyPrompt,
  updateTombstones,
  withoutTombstones,
} from "./totMemoryTidy.ts";

/** Local time each Tot's memory is tidied, or soon after the server next runs. */
const TIDY_HOUR = 3;
const TIDY_MINUTE = 30;
/** A tidy-up that could not finish waits this long before it tries again. */
const RETRY_AFTER_MS = 60 * 60 * 1_000;
const MAX_CLOSED_WORK = 40;

/** The most recent tidy time at or before `nowMs`, in local time. */
export const latestTidySlot = (nowMs: number): number => {
  const slot = new Date(nowMs);
  slot.setHours(TIDY_HOUR, TIDY_MINUTE, 0, 0);
  if (slot.getTime() > nowMs) slot.setDate(slot.getDate() - 1);
  return slot.getTime();
};

const isDenied = (selection: ModelSelection, denied: ReadonlyArray<string>) =>
  [...ALWAYS_DENIED_FALLBACK_MODELS, ...denied].some(
    (entry) => entry.trim().toLowerCase() === selection.model.trim().toLowerCase(),
  );

const make = Effect.gen(function* () {
  const tots = yield* TotService.TotService;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const scheduler = yield* Scheduler.Scheduler;
  const withFiles = <A, E>(
    effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig>,
  ) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(ServerConfig.ServerConfig, config),
    );
  /** In memory: when each Tot may next be looked at, so a tick reads no files. */
  const notBefore = new Map<TotId, number>();

  const closedWorkSince = (tot: Tot, since: string | null) =>
    threads.listProjectThreads({ includeSubagents: false }).pipe(
      Effect.map((entries) =>
        entries
          .filter(
            (entry) =>
              parseTotLaunchedThreadId(entry.id) === tot.id &&
              entry.settledAt !== null &&
              (since === null || entry.settledAt > since),
          )
          .toSorted((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""))
          .slice(0, MAX_CLOSED_WORK)
          .map((entry): ClosedWork => ({ title: entry.title, settledAt: entry.settledAt ?? "" })),
      ),
      Effect.orElseSucceed((): ReadonlyArray<ClosedWork> => []),
    );

  const draftWith = Effect.fn("TotMemoryTidy.draft")(function* (tot: Tot, prompt: string) {
    const settings = yield* settingsService.getSettings;
    const providers = yield* providerRegistry.getProviders;
    const denied = settings.usageLimitFallbackDeniedModels;
    const chosen = resolveTotMemoryTidyModelSelection(settings, providers);
    // Never on a denied model, the full GLM included; that is a setting to fix, not to work around.
    if (isDenied(chosen, denied)) {
      return yield* new TotError({
        message: `${chosen.model} is not allowed for memory tidy-ups. Pick another model in Settings → Tots.`,
      });
    }
    const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-memory-tidy-" });
    const generate = (modelSelection: ModelSelection) =>
      textGeneration.generateMemoryTidy({ cwd, prompt, modelSelection });
    const fallback = chooseUsageLimitFallback({
      candidates: tot.usageLimitFallbackModels ?? settings.usageLimitFallbackModels,
      denied,
      failed: chosen,
    });
    return yield* generate(chosen).pipe(
      Effect.catch((error) => (fallback === null ? Effect.fail(error) : generate(fallback))),
    );
  }, Effect.scoped);

  /** Tidies one Tot's `MEMORY.md` now. Returns whether anything was written. */
  const tidy = Effect.fn("TotMemoryTidy.tidy")(function* (tot: Tot) {
    const files = yield* withFiles(totFiles(tot.id));
    const nowMs = yield* Clock.currentTimeMillis;
    const now = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
    const state = yield* withFiles(readTidyState(tot.id));
    const current = (yield* withFiles(readText(files.memory))) ?? "";
    const lastTidied = yield* withFiles(readText(files.lastTidied));
    const tombstones = updateTombstones({ tombstones: state.tombstones, lastTidied, current });
    const closedWork = yield* closedWorkSince(tot, state.lastTidyAt);
    const settings = yield* settingsService.getSettings;
    const maxBytes = settings.totMemoryTidyMaxBytes;
    const saveState = (next: TidyState) => withFiles(writeText(files.state, encodeState(next)));

    const untouched =
      current.trim() === "" ||
      (current === lastTidied &&
        closedWork.length === 0 &&
        Buffer.byteLength(current, "utf8") <= maxBytes);
    if (untouched) {
      yield* saveState({ lastTidyAt: now, tombstones });
      return false;
    }

    const draft = yield* draftWith(
      tot,
      memoryTidyPrompt({ memory: current, closedWork, maxBytes, today: now.slice(0, 10) }),
    );
    if (draft.memory.trim() === "") {
      return yield* new TotError({
        message: "The model returned an empty memory; nothing changed.",
      });
    }
    const allowed = withoutTombstones(draft.memory, tombstones);
    const blocked = draft.memory.split("\n").length - allowed.split("\n").length;
    const capped = enforceMemoryCap(allowed.trimEnd() + "\n", maxBytes);
    const archived = [...draft.archive, ...capped.overflow]
      .map((line) => line.trim())
      .filter((line) => line !== "");

    // Someone wrote to MEMORY.md while the model worked: theirs wins, try again later.
    if (((yield* withFiles(readText(files.memory))) ?? "") !== current) {
      return yield* new TotError({ message: "MEMORY.md changed during the tidy-up." });
    }
    yield* withFiles(
      Effect.gen(function* () {
        yield* writeText(files.backup, current);
        yield* writeText(
          files.diff,
          [
            `# Memory tidy-up, ${now}`,
            `# Revert: Settings → Tots → ${tot.name} → Revert last tidy-up, or copy ${BACKUP_FILE} over MEMORY.md.`,
            lineDiff(current, capped.memory),
            "",
          ].join("\n"),
        );
        if (archived.length > 0) {
          yield* appendText(
            files.archive(isoMonth(now)),
            [
              `## ${now.slice(0, 10)}`,
              ...archived.map((line) => (line.startsWith("-") ? line : `- ${line}`)),
            ].join("\n"),
          );
        }
        yield* writeText(files.memory, capped.memory);
        yield* writeText(files.lastTidied, capped.memory);
        yield* appendText(
          files.journal(isoMonth(now)),
          journalLine({
            at: now,
            beforeBytes: Buffer.byteLength(current, "utf8"),
            afterBytes: Buffer.byteLength(capped.memory, "utf8"),
            archived: archived.length,
            blocked,
            summary: draft.summary,
          }),
        );
      }),
    );
    yield* saveState({ lastTidyAt: now, tombstones });
    return true;
  });

  const runDue = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const slot = latestTidySlot(nowMs);
    for (const tot of yield* tots.list) {
      if (tot.memoryTidy !== true || tot.projectId === null) continue;
      if ((notBefore.get(tot.id) ?? 0) > nowMs) continue;
      const state = yield* withFiles(readTidyState(tot.id));
      const lastMs = state.lastTidyAt === null ? 0 : Date.parse(state.lastTidyAt);
      if (lastMs >= slot) {
        notBefore.set(tot.id, slot + 24 * 60 * 60 * 1_000);
        continue;
      }
      yield* tidy(tot).pipe(
        Effect.tap(() =>
          Effect.sync(() => notBefore.set(tot.id, latestTidySlot(nowMs) + 24 * 60 * 60 * 1_000)),
        ),
        Effect.catchCause((cause) =>
          Effect.sync(() => notBefore.set(tot.id, nowMs + RETRY_AFTER_MS)).pipe(
            Effect.andThen(
              Effect.logWarning("Tot memory tidy-up failed", { totId: tot.id, cause }),
            ),
          ),
        ),
      );
    }
  });

  yield* scheduler.register("tot-memory-tidy", runDue);
  return { tidy };
});

/** Registers the nightly tidy-up with the scheduler. `tidy` is exported for tests. */
export const makeTotMemoryTidyJob = make;
export const layer = Layer.effectDiscard(make).pipe(Layer.provide(Scheduler.layer));
