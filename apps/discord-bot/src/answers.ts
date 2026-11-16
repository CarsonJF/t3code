export interface QuestionOption {
  readonly label: string;
  readonly description?: string;
  readonly value?: string;
}

/** One question from `t3_pending_request`, whose answers the provider's command accepts. */
export interface Question {
  readonly id: string;
  readonly header?: string;
  readonly question: string;
  readonly options: ReadonlyArray<QuestionOption>;
  readonly multiSelect?: boolean;
  readonly allowCustomAnswer?: boolean;
  readonly required?: boolean;
}

export type AnswerValue = string | ReadonlyArray<string>;

export interface PendingQuestion {
  readonly threadId: string;
  readonly requestId: string;
  readonly questions: ReadonlyArray<Question>;
  readonly answers: Readonly<Record<string, AnswerValue>>;
  /** Index of the question the next reply answers. */
  readonly nextIndex: number;
}

export type AnswerOutcome =
  | { readonly kind: "partial"; readonly pending: PendingQuestion; readonly note: string }
  | {
      readonly kind: "complete";
      readonly pending: PendingQuestion;
      readonly note: string;
      readonly answers: Readonly<Record<string, AnswerValue>>;
    }
  | { readonly kind: "rejected"; readonly pending: PendingQuestion; readonly note: string };

const optionValue = (option: QuestionOption): string => option.value ?? option.label;

const oneLine = (text: string, max = 200): string => {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
};

const describeOptions = (question: Question): string =>
  question.options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");

/** The DM text for the question the user should answer next. */
export const describeQuestion = (
  question: Question,
  position: { readonly index: number; readonly total: number },
): string => {
  const progress =
    position.total > 1 ? `Question ${position.index + 1} of ${position.total}\n` : "";
  const heading = question.header === undefined ? "" : `**${question.header}**\n`;
  const options = describeOptions(question);
  const hint =
    question.options.length === 0
      ? "Reply with your answer."
      : question.multiSelect === true
        ? "Reply with numbers such as 1,3, or type your own answer."
        : "Reply with a number, or type your own answer.";
  return `${progress}${heading}${question.question}${options.length === 0 ? "" : `\n\n${options}`}\n\n${hint}`;
};

const parseSelection = (reply: string, total: number): ReadonlyArray<number> | null => {
  const parts = reply
    .split(/[\s,]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  const numbers: Array<number> = [];
  for (const part of parts) {
    if (!/^\d+$/u.test(part)) return null;
    const index = Number(part) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= total) return null;
    if (!numbers.includes(index)) numbers.push(index);
  }
  return numbers;
};

const summaryOf = (question: Question, value: AnswerValue): string => {
  const label = Array.isArray(value) ? value.join(", ") : value;
  return `${oneLine(question.header ?? question.question, 60)}: ${oneLine(String(label))}`;
};

/**
 * Applies one DM reply to the next unanswered question. Answers accumulate here
 * and reach the provider in one `t3_pending_request respond` call, because a
 * provider expects every question of a request at once.
 */
export const answerQuestion = (pending: PendingQuestion, reply: string): AnswerOutcome => {
  const question = pending.questions[pending.nextIndex];
  if (question === undefined) {
    return {
      kind: "complete",
      pending,
      note: "Nothing is waiting for an answer.",
      answers: pending.answers,
    };
  }
  const trimmed = reply.trim();
  if (trimmed.length === 0) {
    return {
      kind: "rejected",
      pending,
      note: `Type a number from 1 to ${Math.max(1, question.options.length)}, or your own answer.`,
    };
  }
  if (question.required === false && trimmed.toLowerCase() === "skip") {
    return advance(pending, question, "");
  }
  const selection = parseSelection(trimmed, question.options.length);
  if (selection !== null) {
    const values = selection.map((index) => {
      const option = question.options[index];
      return option === undefined ? "" : optionValue(option);
    });
    if (values.length > 1 && question.multiSelect !== true) {
      return {
        kind: "rejected",
        pending,
        note: "That question takes one answer. Reply with one number, or type your own answer.",
      };
    }
    return advance(pending, question, values.length === 1 ? (values[0] ?? "") : values);
  }
  if (question.allowCustomAnswer === false) {
    return {
      kind: "rejected",
      pending,
      note: `That question takes one of its options.\n${describeOptions(question)}`,
    };
  }
  return advance(pending, question, trimmed);
};

const advance = (
  pending: PendingQuestion,
  question: Question,
  value: AnswerValue,
): AnswerOutcome => {
  const answers = { ...pending.answers, [question.id]: value };
  const nextIndex = pending.nextIndex + 1;
  const note = summaryOf(question, value);
  if (nextIndex >= pending.questions.length) {
    return {
      kind: "complete",
      pending: { ...pending, answers, nextIndex },
      note,
      answers,
    };
  }
  return { kind: "partial", pending: { ...pending, answers, nextIndex }, note };
};

export const currentQuestion = (pending: PendingQuestion): Question | undefined =>
  pending.questions[pending.nextIndex];
