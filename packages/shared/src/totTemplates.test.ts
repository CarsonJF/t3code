import { describe, expect, it } from "vite-plus/test";

import { TOT_TEMPLATES, findTotTemplate } from "./totTemplates.ts";

describe("Tot templates", () => {
  it("ships the blank template first and about six in all, with unique ids", () => {
    expect(TOT_TEMPLATES[0]?.id).toBe("blank");
    expect(TOT_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(new Set(TOT_TEMPLATES.map((template) => template.id)).size).toBe(TOT_TEMPLATES.length);
  });

  it("gives every non-blank template instructions, a face and a suggested routine", () => {
    for (const template of TOT_TEMPLATES.filter((candidate) => candidate.id !== "blank")) {
      expect(template.instructions.length).toBeGreaterThan(0);
      expect(template.avatar.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(template.scheduledTasks.length).toBeGreaterThan(0);
      for (const task of template.scheduledTasks) expect(task.schedule.type).not.toBe("webhook");
    }
  });

  it("finds a template by id", () => {
    expect(findTotTemplate("pr-reviewer")?.name).toBe("PR Reviewer");
    expect(findTotTemplate("nope")).toBeUndefined();
  });
});
