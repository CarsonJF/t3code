import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveNewThreadModelSelectionOverride,
  resolveThreadActionProjectRef,
} from "./chatThreadActions";

const PROJECT_DEFAULT_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "project-default",
};
const CARRIED_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "carried-model",
};

describe("chatThreadActions", () => {
  it("does not carry a non-explicit model from the destination draft back into itself", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: null,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-a",
      }),
    ).toBeNull();
  });

  it("keeps the project default above any carried selection", () => {
    expect(
      resolveNewThreadModelSelectionOverride({
        projectDefaultSelection: PROJECT_DEFAULT_SELECTION,
        carrySelection: CARRIED_SELECTION,
        carrySourceDraftId: "draft-a",
        destinationDraftId: "draft-b",
      }),
    ).toEqual(PROJECT_DEFAULT_SELECTION);
  });

  it("starts new work from a Tot's thread in the default project, not the Tot's", () => {
    const environmentId = EnvironmentId.make("local");
    const defaultProjectRef = scopeProjectRef(environmentId, ProjectId.make("project:work"));
    const context = (id: string) => ({
      activeDraftThread: null,
      activeThread: { id, environmentId, projectId: ProjectId.make("project:home") },
      defaultProjectRef,
      handleNewThread: async () => {},
    });
    expect(resolveThreadActionProjectRef(context("tot:home:now"))).toEqual(defaultProjectRef);
    expect(resolveThreadActionProjectRef(context("thread:ordinary"))).toEqual(
      scopeProjectRef(environmentId, ProjectId.make("project:home")),
    );
  });
});
