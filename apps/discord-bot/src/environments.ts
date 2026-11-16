import type { TotAvatar } from "@t3tools/contracts";

import { type Logger, describeError } from "./log.ts";
import type { EnvironmentFailure, TotView } from "./routing.ts";
import { createT3Client, type T3Client } from "./t3Client.ts";
import { listTots } from "./tots.ts";

/** One T3 server the bridge can act on, and the name people see for it. */
export interface BridgeEnvironment {
  readonly label: string;
  readonly mcpUrl: string;
  readonly token: string;
  /** This machine's faces and webhook records, so two never share a file. */
  readonly avatarCacheDir: string;
}

export interface EnvironmentTot extends TotView {
  readonly avatar: TotAvatar;
}

export interface TotCatalogSnapshot {
  readonly tots: ReadonlyArray<EnvironmentTot>;
  readonly failures: ReadonlyArray<EnvironmentFailure>;
}

export interface EnvironmentCatalogOptions {
  readonly environments: ReadonlyArray<BridgeEnvironment>;
  readonly logger: Logger;
  readonly createClient?: (environment: BridgeEnvironment) => T3Client;
}

export interface EnvironmentCatalog {
  readonly environments: ReadonlyArray<BridgeEnvironment>;
  /** The client for one machine, created on first use and reused while it works. */
  readonly clientFor: (environment: string) => T3Client;
  readonly refresh: () => Promise<TotCatalogSnapshot>;
  readonly subscribe: (listener: (snapshot: TotCatalogSnapshot) => void) => () => void;
  readonly close: () => Promise<void>;
}

type LoadResult =
  | { readonly tots: ReadonlyArray<EnvironmentTot> }
  | { readonly failure: EnvironmentFailure };

const defaultClient = (environment: BridgeEnvironment): T3Client =>
  createT3Client({
    url: environment.mcpUrl,
    token: environment.token,
    clientName: "discord-tot-bridge",
  });

/**
 * One MCP client per machine, opened when first needed. A machine that fails
 * is dropped so the next refresh opens a fresh session, and its failure is
 * reported next to the Tots the other machines still serve.
 */
export const createEnvironmentCatalog = (
  options: EnvironmentCatalogOptions,
): EnvironmentCatalog => {
  const clients = new Map<string, T3Client>();
  const failures = new Map<string, number>();
  const seen = new Set<string>();
  const listeners = new Set<(snapshot: TotCatalogSnapshot) => void>();
  const byLabel = new Map(
    options.environments.map((environment) => [environment.label.toLowerCase(), environment]),
  );

  const clientFor = (label: string): T3Client => {
    const environment = byLabel.get(label.toLowerCase());
    if (environment === undefined) {
      throw new Error(`There is no machine labelled ${label || "(unnamed)"}.`);
    }
    const existing = clients.get(environment.label);
    if (existing !== undefined) return existing;
    const created = (options.createClient ?? defaultClient)(environment);
    clients.set(environment.label, created);
    return created;
  };

  const dropClient = (label: string): void => {
    const client = clients.get(label);
    clients.delete(label);
    // A hung connection must not delay the machines that answered this refresh.
    void client?.close().catch(() => undefined);
  };

  const load = async (environment: BridgeEnvironment): Promise<LoadResult> => {
    const previous = failures.get(environment.label) ?? 0;
    const wasSeen = seen.has(environment.label);
    try {
      const tots = await listTots(clientFor(environment.label));
      failures.set(environment.label, 0);
      seen.add(environment.label);
      if (!wasSeen || previous > 0) {
        options.logger.info("environment.ready", {
          environment: environment.label,
          tots: tots.length,
          online: tots.filter((tot) => tot.threadId !== null).length,
          recoveredAfter: previous,
        });
      }
      return {
        tots: tots.map((tot) => ({ ...tot, environment: environment.label })),
      };
    } catch (cause) {
      const count = previous + 1;
      failures.set(environment.label, count);
      const reason = describeError(cause);
      options.logger.warn("environment.failed", {
        environment: environment.label,
        failures: count,
        reason,
      });
      dropClient(environment.label);
      return { failure: { environment: environment.label, reason } };
    }
  };

  return {
    environments: options.environments,
    clientFor,
    refresh: async () => {
      const results = await Promise.all(options.environments.map(load));
      const tots: Array<EnvironmentTot> = [];
      const failed: Array<EnvironmentFailure> = [];
      for (const result of results) {
        if ("tots" in result) tots.push(...result.tots);
        else failed.push(result.failure);
      }
      const snapshot: TotCatalogSnapshot = { tots, failures: failed };
      for (const listener of listeners) {
        try {
          listener(snapshot);
        } catch (cause) {
          options.logger.warn("environment.listener_failed", { reason: describeError(cause) });
        }
      }
      return snapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: async () => {
      await Promise.all(
        [...clients.values()].map((client) => client.close().catch(() => undefined)),
      );
      clients.clear();
      listeners.clear();
    },
  };
};
