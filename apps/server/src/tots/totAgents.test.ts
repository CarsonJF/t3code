import { assert, describe, it } from "@effect/vitest";
import { DEFAULT_HOME_TOT, ProjectId, EnvironmentId, TotId, type Tot } from "@t3tools/contracts";

import { renderTotAgents } from "./totAgents.ts";

const yui: Tot = {
  ...DEFAULT_HOME_TOT,
  id: TotId.make("yui"),
  name: "Yui",
  scope: {
    projects: [
      { environmentId: EnvironmentId.make("env-a"), projectId: ProjectId.make("aincrad") },
    ],
    groups: ["Cardinal Systems"],
  },
  instructions: "Be warm and brief.",
};
const siblings = [DEFAULT_HOME_TOT, yui];

describe("renderTotAgents", () => {
  it("writes both T3 blocks and the instructions into a new file", () => {
    const text = renderTotAgents(yui, siblings, null);
    assert.include(text, "<!-- t3-tot:start -->");
    assert.include(text, "<!-- t3-tot:end -->");
    assert.include(text, "<!-- t3-tot-instructions:start -->");
    assert.include(text, "You are Yui");
    assert.include(text, "Be warm and brief.");
    assert.include(text, "aincrad");
    assert.include(text, "Cardinal Systems");
    assert.include(text, "hand it to Home");
  });

  it("replaces only the T3 blocks and keeps the user's own text", () => {
    const first = renderTotAgents(yui, siblings, null);
    const edited = `${first}\n# Mine\nkeep me\n`;
    const next = renderTotAgents(
      { ...yui, instructions: "Speak like a sysadmin." },
      siblings,
      edited,
    );
    assert.include(next, "keep me");
    assert.include(next, "Speak like a sysadmin.");
    assert.notInclude(next, "Be warm and brief.");
    assert.equal(next.split("<!-- t3-tot:start -->").length, 2);
  });

  it("puts the blocks above a file that has none and keeps its text", () => {
    const next = renderTotAgents(yui, siblings, "my old notes\n");
    assert.isTrue(next.startsWith("<!-- t3-tot:start -->"));
    assert.include(next, "my old notes");
  });

  it("does not tell a Tot that owns everything to hand work to Home", () => {
    const text = renderTotAgents(DEFAULT_HOME_TOT, siblings, null);
    assert.include(text, "every project on every environment");
    assert.notInclude(text, "hand it to Home");
    assert.include(text, "Yui");
  });
});
