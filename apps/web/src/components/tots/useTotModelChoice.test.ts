import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId } from "@t3tools/contracts";

import { firstReadyModel } from "./useTotModelChoice";

const entry = (instanceId: string, status: string, enabled = true) =>
  ({
    instanceId: ProviderInstanceId.make(instanceId),
    enabled,
    isAvailable: true,
    status,
  }) as never;

describe("firstReadyModel", () => {
  it("skips providers that are not ready and uses the first one with a model", () => {
    const models: Record<string, string | null> = { codex: null, claudeAgent: "claude-haiku" };
    expect(
      firstReadyModel(
        [entry("codex", "error"), entry("cursor", "ready", false), entry("claudeAgent", "ready")],
        (instanceId) => models[instanceId] ?? null,
      ),
    ).toEqual({ instanceId: "claudeAgent", model: "claude-haiku" });
  });

  it("finds nothing when no ready provider has a model", () => {
    expect(firstReadyModel([entry("codex", "error")], () => "gpt")).toBeNull();
  });
});
