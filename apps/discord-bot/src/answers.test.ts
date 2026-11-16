import { describe, expect, it } from "vite-plus/test";

import {
  type PendingQuestion,
  type Question,
  answerQuestion,
  describeQuestion,
} from "./answers.ts";

const single: Question = {
  id: "q1",
  header: "Branch",
  question: "Which branch should I use?",
  options: [
    { label: "main", description: "The default branch" },
    { label: "a new branch", value: "feat/x" },
  ],
};

const multi: Question = {
  id: "q2",
  question: "Which checks?",
  options: [{ label: "lint" }, { label: "test" }, { label: "typecheck" }],
  multiSelect: true,
};

const pending = (questions: ReadonlyArray<Question>): PendingQuestion => ({
  threadId: "thread-1",
  requestId: "request-1",
  questions,
  answers: {},
  nextIndex: 0,
});

describe("answerQuestion", () => {
  it("takes an option by number, preferring its value", () => {
    const outcome = answerQuestion(pending([single]), "2");

    expect(outcome.kind).toBe("complete");
    expect(outcome.kind === "complete" ? outcome.answers : null).toEqual({ q1: "feat/x" });
  });

  it("uses the label when an option has no value", () => {
    const outcome = answerQuestion(pending([single]), "1");

    expect(outcome.kind === "complete" ? outcome.answers : null).toEqual({ q1: "main" });
  });

  it("takes several options for a multi-select question", () => {
    const outcome = answerQuestion(pending([multi]), "1,3");

    expect(outcome.kind === "complete" ? outcome.answers : null).toEqual({
      q2: ["lint", "typecheck"],
    });
  });

  it("refuses several options when one is expected", () => {
    const outcome = answerQuestion(pending([single]), "1,2");

    expect(outcome.kind).toBe("rejected");
    expect(outcome.kind === "rejected" ? outcome.note : "").toContain("one answer");
  });

  it("takes free text as a custom answer", () => {
    const outcome = answerQuestion(pending([single]), "feature/wallpaper");

    expect(outcome.kind === "complete" ? outcome.answers : null).toEqual({
      q1: "feature/wallpaper",
    });
  });

  it("refuses free text when the question does not allow it", () => {
    const closed: Question = { ...single, allowCustomAnswer: false };
    const outcome = answerQuestion(pending([closed]), "something else");

    expect(outcome.kind).toBe("rejected");
  });

  it("treats an out-of-range number as text", () => {
    const outcome = answerQuestion(pending([single]), "42");

    expect(outcome.kind === "complete" ? outcome.answers : null).toEqual({ q1: "42" });
  });

  it("refuses an empty reply", () => {
    expect(answerQuestion(pending([single]), "  ").kind).toBe("rejected");
  });

  it("skips an optional question", () => {
    const optional: Question = { ...single, required: false };
    const outcome = answerQuestion(pending([optional]), "skip");

    expect(outcome.kind === "complete" ? outcome.answers : null).toEqual({ q1: "" });
  });

  it("collects one answer at a time and finishes with all of them", () => {
    const first = answerQuestion(pending([single, multi]), "1");

    expect(first.kind).toBe("partial");
    expect(first.kind === "partial" ? first.pending.nextIndex : 0).toBe(1);

    const second = first.kind === "partial" ? answerQuestion(first.pending, "2,3") : first;

    expect(second.kind === "complete" ? second.answers : null).toEqual({
      q1: "main",
      q2: ["test", "typecheck"],
    });
  });
});

describe("describeQuestion", () => {
  it("numbers the options and says how to answer", () => {
    const text = describeQuestion(single, { index: 0, total: 2 });

    expect(text).toContain("Question 1 of 2");
    expect(text).toContain("**Branch**");
    expect(text).toContain("1. main");
    expect(text).toContain("2. a new branch");
    expect(text).toContain("Reply with a number");
  });

  it("asks for numbers when several answers are allowed", () => {
    expect(describeQuestion(multi, { index: 0, total: 1 })).toContain("numbers such as 1,3");
  });

  it("asks for text when there are no options", () => {
    const open: Question = {
      id: "q3",
      question: "What should I name it?",
      options: [],
    };

    expect(describeQuestion(open, { index: 0, total: 1 })).toContain("Reply with your answer.");
  });
});
