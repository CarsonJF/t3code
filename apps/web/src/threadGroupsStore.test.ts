import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import type { LegacyThreadGroupsState } from "./threadGroupsStore";

const DESKTOP = EnvironmentId.make("desktop");
const LAPTOP = EnvironmentId.make("laptop");

const legacy: LegacyThreadGroupsState = {
  groups: [
    { id: "xn", name: " xnproductions ", color: "violet" },
    { id: "blank", name: "   " },
  ],
  projectDefaults: {
    "desktop:project-1": [{ groupId: "xn", since: "2026-10-26T10:00:00.000Z" }],
    "laptop:project-2": [{ groupId: null, since: "2026-10-26T11:00:00.000Z" }],
  },
  threadOverrides: { "desktop:thread-1": null, "laptop:thread-2": "xn", malformed: "xn" },
  collapsed: { xn: true },
};

async function loadStore(stored: LegacyThreadGroupsState | null) {
  vi.resetModules();
  const storage = await import("./hooks/useLocalStorage");
  storage.removeLocalStorageItem("t3code:thread-groups-local:v1");
  storage.removeLocalStorageItem("t3code:thread-groups:v1");
  if (stored) storage.setLocalStorageItem("t3code:thread-groups:v1", stored, Schema.Unknown);
  return import("./threadGroupsStore");
}

describe("legacyThreadGroupsImport", () => {
  it("uploads every named group but only the projects and threads each environment owns", async () => {
    const { legacyThreadGroupsImport } = await loadStore(null);

    expect(legacyThreadGroupsImport(legacy, DESKTOP)).toEqual({
      groups: [{ id: "xn", name: "xnproductions", color: "violet" }],
      projectDefaults: {
        [ProjectId.make("project-1")]: [{ groupId: "xn", since: "2026-10-26T10:00:00.000Z" }],
      },
      threadOverrides: { [ThreadId.make("thread-1")]: null },
    });
    expect(legacyThreadGroupsImport(legacy, LAPTOP)).toEqual({
      groups: [{ id: "xn", name: "xnproductions", color: "violet" }],
      projectDefaults: {
        [ProjectId.make("project-2")]: [{ groupId: null, since: "2026-10-26T11:00:00.000Z" }],
      },
      threadOverrides: { [ThreadId.make("thread-2")]: "xn" },
    });
  });
});

describe("local thread group state", () => {
  it("keeps the legacy collapsed sections and stops reading the legacy blob for them", async () => {
    const store = await loadStore(legacy);

    expect(store.useLocalThreadGroupsStore.getState().collapsed).toEqual({ xn: true });

    store.threadGroupActions.toggleCollapsed("xn");
    const reloaded = await import("./hooks/useLocalStorage").then((storage) =>
      storage.getLocalStorageItem("t3code:thread-groups-local:v1", Schema.Unknown),
    );

    expect(reloaded).toEqual({ collapsed: { xn: false }, migratedEnvironmentIds: [] });
  });
});
