import { EnvironmentId, ProjectId, type ThreadGroupsState } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { threadGroupDeletePrompt } from "./thread-group-delete";

const phone = EnvironmentId.make("environment:laptop");
const server = EnvironmentId.make("environment:server");
const games = { id: "games", name: "Games" };
const state: ThreadGroupsState = {
  groups: [games],
  projectDefaults: {
    [ProjectId.make("project-1")]: [{ groupId: "games", since: "2026-11-01T00:00:00.000Z" }],
  },
  threadOverrides: {},
};
const labelOf = (environmentId: EnvironmentId) => (environmentId === phone ? "Laptop" : "Asuna");

describe("threadGroupDeletePrompt", () => {
  it("names the group, what it holds and its machines, defaulting to one machine", () => {
    const prompt = threadGroupDeletePrompt({
      group: games,
      threadCount: 4,
      byEnvironment: new Map([
        [phone, state],
        [server, state],
      ]),
      labelOf,
    });

    expect(prompt?.title).toBe('Delete group "Games"?');
    expect(prompt?.message).toContain("It holds 2 projects and 4 threads.");
    expect(prompt?.message).toContain("It is on Laptop, Asuna.");
    expect(prompt?.choices).toEqual([
      { label: "Only on Laptop", environmentIds: [phone] },
      { label: "All machines", environmentIds: [phone, server] },
    ]);
  });

  it("offers one Delete when a single machine holds the group", () => {
    const prompt = threadGroupDeletePrompt({
      group: games,
      threadCount: 1,
      byEnvironment: new Map([
        [phone, { ...state, groups: [] }],
        [server, state],
      ]),
      labelOf,
    });

    expect(prompt?.message).toContain("It holds 1 project and 1 thread.");
    expect(prompt?.choices).toEqual([{ label: "Delete", environmentIds: [server] }]);
  });
});
