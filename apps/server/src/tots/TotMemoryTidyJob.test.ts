import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_HOME_TOT,
  ProjectId,
  ProviderInstanceId,
  TextGenerationError,
  ThreadId,
  type ModelSelection,
  type Tot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import { ServerActivation } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as TotMemoryTidyJob from "./TotMemoryTidyJob.ts";
import * as TotService from "./TotService.ts";

const cheap: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
const backup: ModelSelection = { instanceId: ProviderInstanceId.make("claude"), model: "haiku" };
const tot: Tot = { ...DEFAULT_HOME_TOT, projectId: ProjectId.make("tot-home"), memoryTidy: true };
const isTextGenerationError = Schema.is(TextGenerationError);

const harness = (
  replies: ReadonlyArray<unknown>,
  settings: Parameters<typeof ServerSettings.layerTest>[0] = {},
) => {
  const prompts: string[] = [];
  const models: ModelSelection[] = [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(TextGeneration.TextGeneration, {
      generateMemoryTidy: (input: { prompt: string; modelSelection: ModelSelection }) =>
        Effect.suspend(() => {
          prompts.push(input.prompt);
          models.push(input.modelSelection);
          const reply = replies[prompts.length - 1];
          return isTextGenerationError(reply) ? Effect.fail(reply) : Effect.succeed(reply);
        }),
    } as unknown as TextGeneration.TextGeneration["Service"]),
    Layer.succeed(ProviderRegistry.ProviderRegistry, {
      getProviders: Effect.succeed([]),
    } as unknown as ProviderRegistry.ProviderRegistry["Service"]),
    Layer.mock(TotService.TotService)({ list: Effect.succeed([tot]) }),
    Layer.mock(ThreadManagementService.ThreadManagementService)({
      listProjectThreads: () =>
        Effect.succeed([
          {
            id: ThreadId.make("tot-launched:home:fix-ci"),
            title: "Fix the nightly build",
            settledAt: "2026-11-24T18:00:00.000Z",
          },
          {
            id: ThreadId.make("tot-launched:other:x"),
            title: "Someone else's work",
            settledAt: "2026-11-24T18:00:00.000Z",
          },
        ] as never),
    }),
    ServerSettings.layerTest({ textGenerationModelSelection: cheap, ...settings }),
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-memory-tidy-" }).pipe(
      Layer.provide(NodeServices.layer),
    ),
    NodeServices.layer,
  );
  const run = <A, E>(
    body: (
      tidy: (tot: Tot) => Effect.Effect<boolean, unknown>,
      folder: string,
    ) => Effect.Effect<A, E, FileSystem.FileSystem>,
  ) =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-11-25T04:00:00.000Z"));
      const { tidy } = yield* TotMemoryTidyJob.makeTotMemoryTidyJob;
      const config = yield* ServerConfig.ServerConfig;
      return yield* body(tidy, `${config.baseDir}/tots/home`);
    }).pipe(
      Effect.provide(Layer.mergeAll(dependencies, Scheduler.layer)),
      // Park the nightly poll so only the test's own calls tidy.
      Effect.provideService(ServerActivation, Effect.never),
      Effect.scoped,
    );
  return { prompts, models, run };
};

const write = (file: string, text: string) =>
  FileSystem.FileSystem.pipe(
    Effect.tap((fileSystem) =>
      fileSystem.makeDirectory(file.slice(0, file.lastIndexOf("/")), { recursive: true }),
    ),
    Effect.flatMap((fileSystem) => fileSystem.writeFileString(file, text)),
  );
const read = (file: string) =>
  FileSystem.FileSystem.pipe(Effect.flatMap((fileSystem) => fileSystem.readFileString(file)));

it.effect("applies the drafted memory, keeps deleted lines out, and leaves a way back", () => {
  const { run, prompts, models } = harness([
    {
      memory: "# Work\n- Deploys go through staging.\n- The old VPS is at vps-1.\n",
      archive: ["Rebased the fork on 24 Nov."],
      summary: "Merged two deploy lines.",
    },
  ]);
  return run((tidy, folder) =>
    Effect.gen(function* () {
      const before = "# Work\n- Deploys go through staging.\n- Deploys go via staging.\n";
      yield* write(`${folder}/MEMORY.md`, before);
      // The last tidy-up left the VPS line; someone has deleted it since.
      yield* write(`${folder}/.tidy/last.md`, "# Work\n- The old VPS is at vps-1.\n");

      expect(yield* tidy(tot)).toBe(true);
      expect(models.map((model) => model.model)).toEqual([cheap.model]);
      expect(prompts[0]).toContain("Fix the nightly build");
      expect(prompts[0]).not.toContain("Someone else's work");

      expect(yield* read(`${folder}/MEMORY.md`)).toBe("# Work\n- Deploys go through staging.\n");
      expect(yield* read(`${folder}/MEMORY.md.pre-tidy`)).toBe(before);
      expect(yield* read(`${folder}/memory/tidy/last.diff`)).toContain(
        "-- Deploys go via staging.",
      );
      const month = "2026-11";
      expect(yield* read(`${folder}/memory/log/${month}.md`)).toContain(
        "- Rebased the fork on 24 Nov.",
      );
      const journal = yield* read(`${folder}/memory/journal/${month}.md`);
      expect(journal.trim().split("\n")).toHaveLength(1);
      expect(journal).toContain("1 archived, 1 deleted line(s) kept out. Merged two deploy lines.");
      const state = yield* read(`${folder}/.tidy/state.json`);
      expect(JSON.parse(state).tombstones).toEqual(["the old vps is at vps-1."]);
    }),
  );
});

it.effect("tries the Tot's fallback model once when the tidy model fails", () => {
  const { run, models } = harness(
    [
      new TextGenerationError({ operation: "generateMemoryTidy", detail: "usage limit" }),
      { memory: "- kept\n", archive: [], summary: "" },
    ],
    { usageLimitFallbackModels: [backup] },
  );
  return run((tidy, folder) =>
    Effect.gen(function* () {
      yield* write(`${folder}/MEMORY.md`, "- kept\n- kept\n");
      expect(yield* tidy(tot)).toBe(true);
      expect(models.map((model) => model.model)).toEqual([cheap.model, backup.model]);
    }),
  );
});

it.effect("refuses the full GLM and does not call a model when nothing changed", () => {
  const goApi = ProviderInstanceId.make("opencode-go-api");
  const denied = harness([], {
    textGenerators: {
      [goApi]: { kind: "openaiCompatible", baseUrl: "http://127.0.0.1:18999/v1", enabled: true },
    },
    totMemoryTidyModelSelection: { instanceId: goApi, model: "opencode-go/glm-5.3" },
  });
  const quiet = harness([]);
  return Effect.gen(function* () {
    yield* denied.run((tidy, folder) =>
      Effect.gen(function* () {
        yield* write(`${folder}/MEMORY.md`, "- something\n");
        const error = yield* Effect.flip(tidy(tot));
        expect(String((error as { message?: string }).message)).toContain("not allowed");
        expect(denied.models).toEqual([]);
      }),
    );
    yield* quiet.run((tidy, folder) =>
      Effect.gen(function* () {
        yield* write(`${folder}/MEMORY.md`, "- same\n");
        yield* write(`${folder}/.tidy/last.md`, "- same\n");
        // The closed thread predates the last tidy-up, so there is nothing new to fold in.
        yield* write(
          `${folder}/.tidy/state.json`,
          JSON.stringify({ lastTidyAt: "2026-11-25T00:00:00.000Z", tombstones: [] }),
        );
        expect(yield* tidy(tot)).toBe(false);
      }),
    );
    expect(quiet.models).toEqual([]);
  });
});

it("finds the latest 03:30 slot in local time", () => {
  const at = new Date(2026, 10, 25, 3, 29).getTime();
  expect(TotMemoryTidyJob.latestTidySlot(at)).toBe(new Date(2026, 10, 24, 3, 30).getTime());
  const later = new Date(2026, 10, 25, 9, 0).getTime();
  expect(TotMemoryTidyJob.latestTidySlot(later)).toBe(new Date(2026, 10, 25, 3, 30).getTime());
});
