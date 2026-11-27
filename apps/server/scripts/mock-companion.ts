/**
 * The External Companion Protocol v1 fixture on a fixed port, with demo history:
 * `node apps/server/scripts/mock-companion.ts [--port 4790] [--token mock-token]`.
 * Each stdin line is sent as an event, such as {"type":"avatar.state","state":"working"}.
 */
// @effect-diagnostics-next-line nodeBuiltinImport:off -- NodeHttpServer.layer takes Node's own createServer.
import * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeMockCompanion, message } from "../src/companions/mockCompanion.testkit.ts";

const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};
const port = Number(argument("port", "4790"));
const token = argument("token", "mock-token");

const history = {
  main: [
    message("m1", "user", "Can you check why the nightly build failed?", {
      createdAt: "2026-11-25T09:02:00.000Z",
      sourceSurface: "discord",
    }),
    message(
      "m2",
      "assistant",
      "The **macOS** job ran out of runners. I started a thread to retry it on the Intel runner and will tell you when it is green.\n\n- Windows: passed\n- Android: passed\n- macOS: retrying",
      {
        createdAt: "2026-11-25T09:03:00.000Z",
        toolCalls: [
          {
            id: "t1",
            name: "ci.logs",
            status: "done",
            summary: "custom-nightly #412, 3 of 4 jobs passed",
          },
          {
            id: "t2",
            name: "t3_thread_launch",
            status: "done",
            summary: "Retry macOS on macos-15-intel",
          },
        ],
        linkedThreads: [
          { threadId: "thread-retry-macos", title: "Retry the macOS nightly", status: "running" },
        ],
      },
    ),
    message("m3", "user", "Thanks. Ship it when it passes?", {
      createdAt: "2026-11-25T09:10:00.000Z",
      sourceSurface: "voice",
    }),
    message("m4", "assistant", "It passed. Publishing needs your go-ahead.", {
      createdAt: "2026-11-25T09:31:00.000Z",
      needsYou: [
        {
          id: "n1",
          kind: "approval",
          prompt: "Publish the 0.1.12 nightly release now?",
          status: "pending",
        },
      ],
    }),
  ],
  "child:scout": [
    message("s1", "assistant", "Found 3 open issues mentioning the flaky upload test.", {
      createdAt: "2026-11-25T08:40:00.000Z",
      needsYou: [
        {
          id: "n2",
          kind: "question",
          prompt: "Which one should I look at first?",
          options: ["#1021 upload timeout", "#1033 retry loop", "#1040 progress bar"],
          status: "pending",
        },
      ],
    }),
  ],
};

const program = Effect.gen(function* () {
  const mock = yield* makeMockCompanion({ token, history, pageSize: 3 });
  yield* Effect.logInfo(`Mock companion at ${mock.baseUrl} (token ${mock.token})`);
  const services = yield* Effect.context();
  const lines = NodeReadline.createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (line.trim() !== "") Effect.runForkWith(services)(mock.emit(line.trim()));
  });
  return yield* Effect.never;
});

NodeRuntime.runMain(
  program.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.fresh(NodeHttpServer.layer(NodeHttp.createServer, { port, host: "127.0.0.1" })),
    ),
  ),
);
