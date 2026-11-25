import { providerClients } from "@t3tools/client-runtime/provider-clients";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { isThreadWorking } from "@t3tools/client-runtime/state/thread-inbox";
import type { TouchBarProviderLimits, TouchBarThreadStatus } from "@t3tools/contracts";
import {
  collectLimitAccounts,
  collectLimitPools,
  displayLimitWindows,
  type LimitPresentations,
} from "@t3tools/shared/usageLimits";

/** The Limits page's pools, one per provider, cut down to what the Touch Bar draws. */
export function collectTouchBarProviders(
  presentations: LimitPresentations,
  now: number,
): TouchBarProviderLimits[] {
  return collectLimitPools(collectLimitAccounts(presentations), now).flatMap((pool) => {
    const windows = displayLimitWindows(pool).map((window) => ({
      id: window.id.slice(0, 128),
      kind: window.kind,
      label: window.label.slice(0, 80),
      usedPercent: Math.max(0, Math.min(100, window.usedPercent)),
      resetsAt: window.resets[0]?.at ?? null,
    }));
    if (windows.length === 0) return [];
    return [
      {
        driver: pool.driver,
        name: (providerClients.get(pool.driver)?.label ?? String(pool.driver)).slice(0, 64),
        windows: windows.slice(0, 24),
      },
    ];
  });
}

export function touchBarThreadDriver(
  thread: Pick<EnvironmentThreadShell, "environmentId" | "providerInstanceId"> | null,
  presentations: LimitPresentations,
): string | null {
  if (thread === null) return null;
  const providers = presentations.get(thread.environmentId)?.serverConfig?.providers ?? [];
  return (
    providers.find((provider) => provider.instanceId === thread.providerInstanceId)?.driver ?? null
  );
}

export function touchBarThreadStatus(
  thread: Parameters<typeof isThreadWorking>[0] | null,
): TouchBarThreadStatus | null {
  if (thread === null) return null;
  return isThreadWorking(thread) ? "running" : "idle";
}
