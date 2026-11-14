import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, TotId } from "@t3tools/contracts";

import { validateTotDraft, type TotDraft } from "./totEditor.ts";

const draft = (overrides: Partial<TotDraft>): TotDraft => ({
  name: "Yui",
  color: "#0A7EA4",
  skin: null,
  scope: "all",
  instructions: "Be warm.",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  ...overrides,
});
const home = TotId.make("home");

describe("validateTotDraft", () => {
  it("needs a name", () => {
    expect(validateTotDraft(draft({ name: "   " }), [], null)).toMatchObject({
      ok: false,
      errors: { name: "Give the Tot a name." },
    });
  });

  it("refuses a name another Tot already has, but lets a Tot keep its own", () => {
    expect(validateTotDraft(draft({ name: "Home" }), [home], null)).toMatchObject({
      ok: false,
      errors: { name: "A Tot named like this already exists." },
    });
    expect(validateTotDraft(draft({ name: "Home" }), [home], home).ok).toBe(true);
  });

  it("needs a #rrggbb color", () => {
    expect(validateTotDraft(draft({ color: "#12345" }), [], null)).toMatchObject({
      ok: false,
      errors: { color: "Pick a color like #0A7EA4." },
    });
  });

  it("needs at least one project or group when the scope is not everything", () => {
    expect(
      validateTotDraft(draft({ scope: { projects: [], groups: [] } }), [], null),
    ).toMatchObject({ ok: false, errors: { scope: "Pick at least one project, or Everything." } });
    const scoped = validateTotDraft(
      draft({
        scope: {
          projects: [
            { environmentId: EnvironmentId.make("asuna"), projectId: ProjectId.make("aincrad") },
          ],
          groups: [],
        },
      }),
      [],
      null,
    );
    expect(scoped.ok).toBe(true);
  });

  it("trims the name and returns what the create call takes", () => {
    expect(validateTotDraft(draft({ name: "  Yui  ", skin: 301 }), [], null)).toEqual({
      ok: true,
      value: {
        name: "Yui",
        avatar: { color: "#0A7EA4", skin: 301 },
        scope: "all",
        instructions: "Be warm.",
        modelSelection: { instanceId: "codex", model: "gpt-5" },
      },
    });
  });
});
