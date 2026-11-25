import {
  type NeedsYouItem,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2TurnItem,
  parseTotLaunchedThreadId,
  parseTotThreadId,
  ProviderRequestKind,
  type ScheduledTask,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const SUMMARY_MAX_LENGTH = 160;
const isApprovalKind = Schema.is(ProviderRequestKind);

const oneLine = (text: string, max = SUMMARY_MAX_LENGTH) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
};

/** The Tot a thread belongs to: its own thread, or one it launched. */
const threadTotId = (threadId: string) =>
  parseTotThreadId(threadId) ?? parseTotLaunchedThreadId(threadId);

const millis = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.toEpochMillis(value);

/** Pending approvals and questions in one thread. */
export const requestItems = (input: {
  readonly shell: OrchestrationV2ThreadShell;
  readonly requests: ReadonlyArray<OrchestrationV2RuntimeRequest>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
}): ReadonlyArray<NeedsYouItem> => {
  const { shell } = input;
  return input.requests.flatMap((request): ReadonlyArray<NeedsYouItem> => {
    if (request.status !== "pending") return [];
    const base = {
      key: `request:${shell.id}:${request.id}`,
      threadId: shell.id,
      title: shell.title,
      at: DateTime.formatIso(request.createdAt),
      totId: threadTotId(shell.id),
      requestId: request.id,
    };
    if (isApprovalKind(request.kind)) {
      const item = input.turnItems.find(
        (candidate) => candidate.type === "approval_request" && candidate.requestId === request.id,
      );
      const detail =
        item?.type === "approval_request" ? (item.prompt ?? item.reason ?? null) : null;
      return [
        {
          ...base,
          kind: "approval",
          approvalKind: request.kind,
          summary: oneLine(
            detail === null ? `Approve ${request.kind}` : `${request.kind}: ${detail}`,
          ),
        },
      ];
    }
    if (request.kind !== "user_input") return [];
    const item = input.turnItems.find(
      (candidate) => candidate.type === "user_input_request" && candidate.requestId === request.id,
    );
    const questions = item?.type === "user_input_request" ? item.questions : [];
    // A secret or link card is answered only in its thread, never as plain text from here.
    const userOnly =
      shell.pendingRuntimeRequest?.id === request.id &&
      shell.pendingRuntimeRequest.userOnly === true;
    const first = questions[0];
    return [
      {
        ...base,
        kind: "question",
        summary:
          first === undefined
            ? "Waiting for your answer"
            : oneLine(
                questions.length > 1
                  ? `${first.question} (+${questions.length - 1} more)`
                  : first.question,
              ),
        ...(questions.length > 0 && !userOnly ? { questions } : {}),
      },
    ];
  });
};

/** A failed or stopped top-level run that finished after the user last opened its thread. */
export const runItem = (shell: OrchestrationV2ThreadShell): NeedsYouItem | null => {
  if (shell.status !== "failed" && shell.status !== "interrupted") return null;
  // Subagents and workflow steps report to whoever started them.
  if (shell.lineage.relationshipToParent === "subagent" || shell.lineage.workflowStep === true)
    return null;
  if (shell.archivedAt !== null || shell.deletedAt !== null) return null;
  const completed = millis(shell.latestRunCompletedAt);
  if (completed === null || shell.latestRunId === null) return null;
  const visited = millis(shell.lastVisitedAt);
  if (visited !== null && visited >= completed) return null;
  const failed = shell.status === "failed";
  return {
    key: `run:${shell.id}:${shell.latestRunId}`,
    kind: failed ? "failed_run" : "stopped_run",
    threadId: shell.id,
    title: shell.title,
    at: new Date(completed).toISOString(),
    totId: threadTotId(shell.id),
    summary: failed ? oneLine(`Failed: ${shell.lastError ?? "no error recorded"}`) : "Stopped",
  };
};

export const scheduledItem = (task: ScheduledTask): NeedsYouItem | null =>
  task.lastRunStatus !== "failed" || task.lastRunAt === null
    ? null
    : {
        key: `scheduled:${task.id}:${task.lastRunAt}`,
        kind: "scheduled_failure",
        threadId: task.threadId,
        title: task.title,
        at: task.lastRunAt,
        totId: task.createdByTotId ?? null,
        scheduledTaskId: task.id,
        summary: oneLine(`Scheduled run failed: ${task.lastRunError ?? "no error recorded"}`),
      };

export interface HiddenEntry {
  readonly environmentId: string;
  readonly key: string;
  /** Null: dismissed until the item goes away. */
  readonly until: string | null;
}

const hideLapsed = (entry: HiddenEntry, now: number) =>
  entry.until !== null && Date.parse(entry.until) <= now;

/** Drops hidden items, or marks them when `includeHidden`. A lapsed snooze shows the item again. */
export const applyHidden = (
  environmentId: string,
  items: ReadonlyArray<NeedsYouItem>,
  hidden: ReadonlyArray<HiddenEntry>,
  now: number,
  includeHidden: boolean,
): ReadonlyArray<NeedsYouItem> =>
  items.flatMap((item) => {
    const entry = hidden.find(
      (candidate) => candidate.environmentId === environmentId && candidate.key === item.key,
    );
    if (entry === undefined || hideLapsed(entry, now)) return [item];
    return includeHidden ? [{ ...item, hiddenUntil: entry.until }] : [];
  });

/**
 * The entries still worth keeping: unlapsed, and for an environment that was read, naming an item
 * that still waits. An entry for an unreadable environment stays until it is read again.
 */
export const pruneHidden = (
  hidden: ReadonlyArray<HiddenEntry>,
  read: ReadonlyMap<string, ReadonlySet<string>>,
  now: number,
): ReadonlyArray<HiddenEntry> =>
  hidden.filter((entry) => {
    if (hideLapsed(entry, now)) return false;
    const keys = read.get(entry.environmentId);
    return keys === undefined || keys.has(entry.key);
  });

export const newestFirst = (items: ReadonlyArray<NeedsYouItem>) =>
  items.toSorted((left, right) => Date.parse(right.at) - Date.parse(left.at));

/** The prompt for questions the agent offered no options for. */
export const replySuggestionPrompt = (
  title: string,
  questions: ReadonlyArray<{
    readonly id: string;
    readonly header: string;
    readonly question: string;
  }>,
) =>
  [
    "A coding agent asked the person it works for the questions below.",
    "For each question, suggest 2 or 3 short, distinct replies the person might send, each under 15 words, written as the person.",
    "Do not answer for the agent and do not invent facts; prefer replies that decide, defer, or ask for what is missing.",
    `Thread: ${oneLine(title, 200)}`,
    ...questions.map(
      (question) =>
        `Question id ${JSON.stringify(question.id)} (${oneLine(question.header, 80)}): ${oneLine(question.question, 1_000)}`,
    ),
    'Return only JSON: {"suggestions":[{"questionId":"…","answers":["…"]}]}',
  ].join("\n\n");

/** At most three trimmed, distinct, non-empty replies per question asked. */
export const cleanSuggestions = (
  askedIds: ReadonlySet<string>,
  raw: ReadonlyArray<{ readonly questionId: string; readonly answers: ReadonlyArray<string> }>,
) =>
  raw.flatMap((entry) => {
    if (!askedIds.has(entry.questionId)) return [];
    const answers = [
      ...new Set(entry.answers.map((answer) => oneLine(answer, 200)).filter((a) => a !== "")),
    ].slice(0, 3);
    return answers.length === 0 ? [] : [{ questionId: entry.questionId, answers }];
  });
