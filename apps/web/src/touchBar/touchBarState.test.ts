import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import type { LimitPresentations } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import {
  collectTouchBarProviders,
  touchBarThreadDriver,
  touchBarThreadStatus,
} from "./touchBarState";

const now = Date.parse("2026-11-25T12:00:00.000Z");
const environmentId = EnvironmentId.make("local");

function provider(overrides: Partial<ServerProvider>): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("claude"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated", email: "someone@example.com" },
    checkedAt: "2026-11-25T11:59:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const presentations = (providers: ServerProvider[]): LimitPresentations =>
  new Map([
    [environmentId, { entry: { target: { label: "This Mac" } }, serverConfig: { providers } }],
  ]);

const claude = provider({
  usageLimits: {
    checkedAt: "2026-11-25T11:59:00.000Z",
    windows: [
      {
        id: "seven_day_fable",
        kind: "weekly",
        label: "Weekly · Fable",
        usedPercent: 88,
        resetsAt: "2026-11-30T09:00:00.000Z",
      },
      {
        id: "five_hour",
        kind: "session",
        label: "Session",
        usedPercent: 42.4,
        resetsAt: "2026-11-25T15:00:00.000Z",
        windowDurationMins: 300,
      },
    ],
  },
});

describe("collectTouchBarProviders", () => {
  it("reads the Limits page's pools with session first and resets as epoch times", () => {
    expect(collectTouchBarProviders(presentations([claude]), now)).toEqual([
      {
        driver: "claudeAgent",
        name: "Claude",
        windows: [
          {
            id: "five_hour",
            kind: "session",
            label: "Session",
            usedPercent: 42,
            resetsAt: Date.parse("2026-11-25T15:00:00.000Z"),
          },
          {
            id: "seven_day_fable",
            kind: "weekly",
            label: "Weekly · Fable",
            usedPercent: 88,
            resetsAt: Date.parse("2026-11-30T09:00:00.000Z"),
          },
        ],
      },
    ]);
  });

  it("skips providers without limit windows", () => {
    expect(collectTouchBarProviders(presentations([provider({})]), now)).toEqual([]);
  });
});

describe("focused thread", () => {
  it("maps the thread's provider instance to its driver", () => {
    const codex = provider({
      instanceId: ProviderInstanceId.make("work"),
      driver: ProviderDriverKind.make("codex"),
    });
    const all = presentations([claude, codex]);
    const thread = { environmentId, providerInstanceId: ProviderInstanceId.make("work") };
    expect(touchBarThreadDriver(thread, all)).toBe("codex");
    expect(
      touchBarThreadDriver({ ...thread, providerInstanceId: ProviderInstanceId.make("gone") }, all),
    ).toBeNull();
    expect(touchBarThreadDriver(null, all)).toBeNull();
  });

  it("reads running or idle from the thread's run", () => {
    const idle = {
      hasActionableProposedPlan: false,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      pendingSubagentRequest: null,
      interactionMode: "default",
      latestRun: null,
      runtime: null,
    } as const;
    expect(touchBarThreadStatus(null)).toBeNull();
    expect(touchBarThreadStatus(idle as never)).toBe("idle");
  });
});
