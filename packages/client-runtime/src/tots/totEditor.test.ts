import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, TotId } from "@t3tools/contracts";

import { findTotTemplate } from "@t3tools/shared/totTemplates";

import { applyTotTemplate, validateTotDraft, type TotDraft } from "./totEditor.ts";

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
    expect(
      validateTotDraft(draft({ name: "  Yui  ", skin: 301, shape: "flower" }), [], null),
    ).toEqual({
      ok: true,
      value: {
        name: "Yui",
        avatar: { color: "#0A7EA4", skin: 301, shape: "flower" },
        scope: "all",
        instructions: "Be warm.",
        modelSelection: { instanceId: "codex", model: "gpt-5" },
      },
    });
    const round = validateTotDraft(draft({ shape: "round" }), [], null);
    expect(round.ok && round.value.avatar).toEqual({ color: "#0A7EA4" });
    const antenna = validateTotDraft(draft({ antenna: true }), [], null);
    expect(antenna.ok && antenna.value.avatar).toEqual({ color: "#0A7EA4", antenna: true });
    const accessories = validateTotDraft(
      draft({ accessories: [{ kind: "glasses" }, { kind: "halo", color: "#F4C84B" }] }),
      [],
      null,
    );
    expect(accessories.ok && accessories.value.avatar).toEqual({
      color: "#0A7EA4",
      accessories: [{ kind: "glasses" }, { kind: "halo", color: "#F4C84B" }],
    });
    const bare = validateTotDraft(draft({ accessories: [] }), [], null);
    expect(bare.ok && bare.value.avatar).toEqual({ color: "#0A7EA4" });
  });

  it("keeps the open-bot look, and stores no style for BoopFace", () => {
    const openBot = { figure: "mug", depth: 3 };
    const chosen = validateTotDraft(draft({ style: "open-bot", openBot }), [], null);
    expect(chosen.ok && chosen.value.avatar).toEqual({
      color: "#0A7EA4",
      style: "open-bot",
      openBot,
    });
    // Switched back to BoopFace: the open-bot look stays stored for the next switch.
    const back = validateTotDraft(draft({ style: "boopface", openBot }), [], null);
    expect(back.ok && back.value.avatar).toEqual({ color: "#0A7EA4", openBot });
  });
});

describe("Tot templates", () => {
  const ci = findTotTemplate("ci-babysitter")!;
  const stack = findTotTemplate("home-stack-watcher")!;
  const blank = findTotTemplate("blank")!;

  it("sends the template and memory tidy-up with a new Tot", () => {
    const checked = validateTotDraft(
      draft({ template: "ci-babysitter", memoryTidy: true }),
      [],
      null,
    );
    expect(checked).toMatchObject({
      ok: true,
      value: { template: "ci-babysitter", memoryTidy: true },
    });
    const plain = validateTotDraft(draft({}), [], null);
    expect(plain.ok && "template" in plain.value).toBe(false);
  });

  it("fills an empty name and replaces the previous template's name, but keeps a typed one", () => {
    const filled = applyTotTemplate(draft({ name: "" }), ci, undefined);
    expect(filled).toMatchObject({ name: ci.name, instructions: ci.instructions, template: ci.id });
    expect(applyTotTemplate(filled, stack, ci).name).toBe(stack.name);
    expect(applyTotTemplate(draft({ name: "Yui" }), stack, ci).name).toBe("Yui");
    expect(applyTotTemplate(filled, blank, ci)).toMatchObject({ name: "", instructions: "" });
  });

  it("suggests the template's scope type", () => {
    expect(applyTotTemplate(draft({ scope: "all" }), ci, undefined).scope).toEqual({
      projects: [],
      groups: [],
    });
    const picked = { projects: [], groups: ["Infra"] };
    expect(applyTotTemplate(draft({ scope: picked }), ci, undefined).scope).toBe(picked);
    expect(applyTotTemplate(draft({ scope: picked }), stack, undefined).scope).toBe("all");
  });
});
