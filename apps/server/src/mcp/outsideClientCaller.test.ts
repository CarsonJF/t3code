import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import type * as McpInvocationContext from "./McpInvocationContext.ts";
import { outsideClientCaller } from "./OrchestratorMcpService.ts";

const client = (
  extra: Partial<McpInvocationContext.McpClientCaller> = {},
): McpInvocationContext.McpInvocationScope =>
  ({
    environmentId: EnvironmentId.make("environment"),
    requestNamespace: "client:test",
    capabilities: new Set(["orchestration"]),
    client: {
      sessionId: "session-1",
      label: "discord-tot-bridge",
      access: "full-access",
      ...extra,
    },
  }) as unknown as McpInvocationContext.McpInvocationScope;

it.each([
  [
    "an outside client by its name",
    client(),
    { caller: { origin: "companion", id: "discord-tot-bridge" } },
  ],
  [
    "the Discord user the bridge relays for",
    client({ onBehalfOf: { service: "discord", userId: "111" } }),
    { caller: { origin: "discord", id: "111", label: "discord-tot-bridge" } },
  ],
  // A peer link names its own sender thread instead.
  ["nobody for a peer link", client({ linked: true }), {}],
] as const)("names %s", (_label, scope, expected) => {
  expect(outsideClientCaller(scope, undefined)).toEqual(expected);
});

it("names nobody for a thread here, which records its own sender", () => {
  const scope = {
    ...client({ onBehalfOf: { service: "discord", userId: "111" } }),
    thread: {
      threadId: ThreadId.make("thread:x"),
      providerSessionId: "p",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
  };
  expect(outsideClientCaller(scope, undefined)).toEqual({});
});
