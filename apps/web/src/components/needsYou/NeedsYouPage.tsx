import {
  needsYouAge,
  needsYouAnswers,
  needsYouOptionValue,
  type NeedsYouMachine,
} from "@t3tools/client-runtime/needs-you";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { NeedsYouItem, OrchestrationV2UserInputQuestion } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, Var } from "gt-react";
import {
  AlarmClockIcon,
  BotMessageSquareIcon,
  ArrowUpRightIcon,
  CalendarXIcon,
  ScanSearchIcon,
  CircleStopIcon,
  CircleXIcon,
  InboxIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  LightbulbIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { linkedThreadRouteParams } from "../../linkedThreadSurface";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { CompanionNeedsYouActions } from "../companions/CompanionNeedsYouActions";
import { useNeedsYou } from "./useNeedsYou";

const KIND_ICONS = {
  approval: ShieldQuestionIcon,
  question: MessageCircleQuestionIcon,
  failed_run: CircleXIcon,
  stopped_run: CircleStopIcon,
  scheduled_failure: CalendarXIcon,
  companion: BotMessageSquareIcon,
  sweep_attention: ScanSearchIcon,
} as const;

function reportResult(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

const tomorrowMorning = (now: Date) => {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return next;
};

/** One inbox of approvals, questions and failures across every Tot and machine. */
export function NeedsYouPage() {
  const inbox = useNeedsYou();
  const [now] = useState(() => Date.now());
  const hiddenCount = inbox.machines.reduce((total, machine) => total + machine.hidden.length, 0);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b">
          <h1 className="truncate text-sm font-medium">
            <T>Needs you</T>
          </h1>
          {inbox.count > 0 ? <Badge variant="secondary">{inbox.count}</Badge> : null}
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both" data-needs-you-panel>
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5">
            {inbox.count === 0 ? (
              <Empty size="hero">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <InboxIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    <T>Nothing needs you</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>
                      Approvals, questions and failed runs from every Tot, companion and linked
                      machine show up here.
                    </T>
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            {inbox.machines.map((machine) =>
              machine.sections.length === 0 && machine.error === null ? null : (
                <MachineGroup
                  key={machine.environmentId}
                  machine={machine}
                  now={now}
                  showLabel={inbox.machines.length > 1}
                />
              ),
            )}
            {hiddenCount > 0 ? <HiddenItems machines={inbox.machines} /> : null}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

function MachineGroup(props: {
  readonly machine: NeedsYouMachine;
  readonly now: number;
  readonly showLabel: boolean;
}) {
  const { machine } = props;
  return (
    <section className="flex flex-col gap-3" data-needs-you-machine={machine.environmentId}>
      {props.showLabel || machine.error !== null ? (
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {machine.label}
        </h2>
      ) : null}
      {machine.error === null ? null : (
        <p className="text-sm text-muted-foreground">
          <T>Could not read this machine:</T> {machine.error}
        </p>
      )}
      {machine.sections.map((section) => (
        <div key={section.companionId ?? section.totId ?? ""} className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">
            {section.totName ?? <T context="items not from any Tot">Threads</T>}
          </h3>
          <ul className="flex flex-col gap-2">
            {section.items.map((item) => (
              <NeedsYouRow key={item.key} item={item} machine={machine} now={props.now} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function useOpenItem(machine: NeedsYouMachine) {
  const navigate = useNavigate();
  return (item: NeedsYouItem) => {
    if (item.companion !== undefined) {
      void navigate({
        to: "/companions/$environmentId/$companionId",
        params: { environmentId: machine.environmentId, companionId: item.companion.companionId },
        search: { channel: item.companion.channel },
      });
      return;
    }
    if (item.threadId === null) {
      void navigate({ to: "/settings/scheduled-tasks" });
      return;
    }
    const ref = { environmentId: machine.environmentId, threadId: item.threadId };
    void (machine.connected
      ? navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) })
      : navigate({
          to: "/linked/$viaEnvironmentId/$linkedEnvironmentId/$linkedThreadId",
          params: linkedThreadRouteParams({ viaEnvironmentId: machine.via, ...ref }),
        }));
  };
}

function NeedsYouRow(props: {
  readonly item: NeedsYouItem;
  readonly machine: NeedsYouMachine;
  readonly now: number;
}) {
  const { item, machine } = props;
  const gt = useGT();
  const open = useOpenItem(machine);
  const hide = useAtomCommand(serverEnvironment.hideNeedsYou, { reportFailure: false });
  const Icon = KIND_ICONS[item.kind];
  const hideUntil = async (until: Date | null) =>
    reportResult(
      gt("Could not hide it"),
      await hide({
        environmentId: machine.via,
        input: {
          environmentId: machine.environmentId,
          key: item.key,
          until: until === null ? null : until.toISOString(),
        },
      }),
    );
  const kindLabel = {
    approval: gt("Approval"),
    question: gt("Question"),
    failed_run: gt("Failed run"),
    stopped_run: gt("Stopped run"),
    scheduled_failure: gt("Scheduled run failed"),
    companion: gt("Companion"),
    sweep_attention: gt("Look around found something"),
  }[item.kind];
  return (
    <li
      className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5"
      data-needs-you-item={item.kind}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label={kindLabel} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button
            type="button"
            onClick={() => open(item)}
            className="min-w-0 cursor-pointer truncate text-left text-sm font-medium hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {item.title}
          </button>
          <p className="line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {needsYouAge(item.at, props.now)}
        </span>
      </div>
      {item.kind === "approval" && item.requestId !== undefined ? (
        <ApprovalActions item={item} machine={machine} />
      ) : null}
      {item.kind === "question" && item.questions !== undefined ? (
        <QuestionAnswer item={item} questions={item.questions} machine={machine} />
      ) : null}
      {item.companion === undefined ? null : machine.connected ? (
        <CompanionNeedsYouActions
          environmentId={machine.environmentId}
          companionId={item.companion.companionId}
          needsYouId={item.companion.needsYouId}
          kind={item.companion.kind}
          options={item.companion.options}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          <T>
            Connect this app to <Var>{machine.label}</Var> to answer its companions here.
          </T>
        </p>
      )}
      {item.retryAccounts !== undefined && item.retryAccounts.length > 0 ? (
        <RetryOnAccount item={item} accounts={item.retryAccounts} machine={machine} />
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <Button size="compact" variant="ghost-muted" onClick={() => open(item)}>
          <ArrowUpRightIcon />
          {item.companion !== undefined ? (
            <T>Open companion</T>
          ) : item.threadId === null ? (
            <T>Scheduled tasks</T>
          ) : (
            <T>Open thread</T>
          )}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button size="compact" variant="ghost-muted">
                <AlarmClockIcon />
                <T>Snooze</T>
              </Button>
            }
          />
          <MenuPopup>
            <MenuItem onClick={() => void hideUntil(new Date(Date.now() + 3_600_000))}>
              <T>For an hour</T>
            </MenuItem>
            <MenuItem onClick={() => void hideUntil(new Date(Date.now() + 4 * 3_600_000))}>
              <T>For four hours</T>
            </MenuItem>
            <MenuItem onClick={() => void hideUntil(tomorrowMorning(new Date()))}>
              <T>Until tomorrow morning</T>
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Button size="compact" variant="ghost-muted" onClick={() => void hideUntil(null)}>
          <XIcon />
          <T>Dismiss</T>
        </Button>
      </div>
    </li>
  );
}

function ApprovalActions(props: {
  readonly item: NeedsYouItem;
  readonly machine: NeedsYouMachine;
}) {
  const gt = useGT();
  const respond = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const [pending, setPending] = useState(false);
  const { item, machine } = props;
  if (!machine.connected) {
    return (
      <p className="text-xs text-muted-foreground">
        <T>
          Connect this app to <Var>{machine.label}</Var> to approve here, or open the thread there.
        </T>
      </p>
    );
  }
  const decide = async (decision: "accept" | "decline") => {
    if (item.threadId === null || item.requestId === undefined) return;
    setPending(true);
    const result = await respond({
      environmentId: machine.environmentId,
      input: { threadId: item.threadId, requestId: item.requestId, decision },
    });
    setPending(false);
    reportResult(gt("Could not send the decision"), result);
  };
  return (
    <div className="flex gap-2">
      <Button size="compact" disabled={pending} onClick={() => void decide("accept")}>
        <T>Approve</T>
      </Button>
      <Button
        size="compact"
        variant="outline"
        disabled={pending}
        onClick={() => void decide("decline")}
      >
        <T>Decline</T>
      </Button>
    </div>
  );
}

function RetryOnAccount(props: {
  readonly item: NeedsYouItem;
  readonly accounts: NonNullable<NeedsYouItem["retryAccounts"]>;
  readonly machine: NeedsYouMachine;
}) {
  const gt = useGT();
  const retry = useAtomCommand(serverEnvironment.retryOnAccount, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const { item, machine } = props;
  if (!machine.connected) {
    return (
      <p className="text-xs text-muted-foreground">
        <T>
          Connect this app to <Var>{machine.label}</Var> to retry on another account here, or open
          the thread there.
        </T>
      </p>
    );
  }
  const retryOn = async (instanceId: (typeof props.accounts)[number]["instanceId"]) => {
    if (item.threadId === null || item.runId === undefined) return;
    setPending(true);
    const result = await retry({
      environmentId: machine.environmentId,
      input: { threadId: item.threadId, runId: item.runId, instanceId },
    });
    setPending(false);
    reportResult(gt("Could not retry on that account"), result);
  };
  return (
    <div className="flex flex-wrap gap-2">
      {props.accounts.map((account) => (
        <Button
          key={account.instanceId}
          size="compact"
          variant="outline"
          disabled={pending}
          onClick={() => void retryOn(account.instanceId)}
        >
          <RotateCcwIcon />
          <T>
            Retry on <Var>{account.label}</Var>
          </T>
        </Button>
      ))}
    </div>
  );
}

function QuestionAnswer(props: {
  readonly item: NeedsYouItem;
  readonly questions: ReadonlyArray<OrchestrationV2UserInputQuestion>;
  readonly machine: NeedsYouMachine;
}) {
  const { item, machine } = props;
  const gt = useGT();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const respondHere = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const respondThere = useAtomCommand(serverEnvironment.respondNeedsYou, {
    reportFailure: false,
  });
  const wantsSuggestions = props.questions.some(
    (question) => question.options.length === 0 && question.allowCustomAnswer !== false,
  );
  const suggestions = useEnvironmentQuery(
    wantsSuggestions
      ? serverEnvironment.needsYouSuggestions({
          environmentId: machine.via,
          input: { environmentId: machine.environmentId, key: item.key },
        })
      : null,
  );
  const answers = needsYouAnswers(props.questions, picked);
  const send = async () => {
    if (answers === null || item.threadId === null || item.requestId === undefined) return;
    setPending(true);
    const target = { threadId: item.threadId, requestId: item.requestId, answers };
    const result = machine.connected
      ? await respondHere({ environmentId: machine.environmentId, input: target })
      : await respondThere({
          environmentId: machine.via,
          input: { environmentId: machine.environmentId, ...target },
        });
    setPending(false);
    reportResult(gt("Could not send the answer"), result);
  };
  return (
    <div className="flex flex-col gap-3">
      {props.questions.map((question) => {
        const suggested =
          suggestions.data?.suggestions.find((entry) => entry.questionId === question.id)
            ?.answers ?? [];
        const choose = (value: string) =>
          setPicked((current) => ({ ...current, [question.id]: value }));
        return (
          <div key={question.id} className="flex flex-col gap-1.5">
            {props.questions.length > 1 ? (
              <p className="text-sm">
                <span className="font-medium">{question.header}:</span> {question.question}
              </p>
            ) : null}
            {question.options.length > 0 ? (
              <div className="flex flex-wrap gap-1.5" data-needs-you-options>
                {question.options.map((option) => (
                  <Chip
                    key={option.label}
                    selected={picked[question.id] === needsYouOptionValue(option)}
                    description={option.description}
                    onClick={() => choose(needsYouOptionValue(option))}
                  >
                    {option.label}
                  </Chip>
                ))}
              </div>
            ) : null}
            {suggested.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5" data-needs-you-suggestions>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <LightbulbIcon className="size-3" />
                  <T context="replies a model suggested, not sent until picked and sent">
                    Suggested
                  </T>
                </span>
                {suggested.map((answer) => (
                  <Chip
                    key={answer}
                    selected={picked[question.id] === answer}
                    dashed
                    onClick={() => choose(answer)}
                  >
                    {answer}
                  </Chip>
                ))}
              </div>
            ) : wantsSuggestions && suggestions.isPending ? (
              <span className="text-xs text-muted-foreground">
                <T>Thinking of replies…</T>
              </span>
            ) : null}
            {question.allowCustomAnswer === false ? null : (
              <Input
                size="sm"
                aria-label={question.question}
                placeholder={gt("Type an answer")}
                value={picked[question.id] ?? ""}
                onChange={(event) => choose(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) void send();
                }}
              />
            )}
          </div>
        );
      })}
      <div>
        <Button size="compact" disabled={answers === null || pending} onClick={() => void send()}>
          <T>Send answer</T>
        </Button>
      </div>
    </div>
  );
}

function Chip(props: {
  readonly selected: boolean;
  readonly dashed?: boolean;
  readonly description?: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  const chip = (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={
        "cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring " +
        (props.dashed ? "border-dashed " : "") +
        (props.selected
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground")
      }
    >
      {props.children}
    </button>
  );
  if (props.description === undefined) return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup side="top">{props.description}</TooltipPopup>
    </Tooltip>
  );
}

function HiddenItems(props: { readonly machines: ReadonlyArray<NeedsYouMachine> }) {
  const gt = useGT();
  const restore = useAtomCommand(serverEnvironment.restoreNeedsYou, { reportFailure: false });
  const [open, setOpen] = useState(false);
  const hidden = props.machines.flatMap((machine) =>
    machine.hidden.map((item) => ({ machine, item })),
  );
  return (
    <section className="flex flex-col gap-2 border-t pt-4">
      <Button
        size="compact"
        variant="ghost-muted"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <T>
          Snoozed and dismissed (<Var>{hidden.length}</Var>)
        </T>
      </Button>
      {open ? (
        <ul className="flex flex-col gap-1">
          {hidden.map(({ machine, item }) => (
            <li
              key={`${machine.environmentId}:${item.key}`}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <span className="min-w-0 flex-1 truncate">
                {item.title}: {item.summary}
              </span>
              <span className="shrink-0 text-xs">
                {item.hiddenUntil === null || item.hiddenUntil === undefined ? (
                  <T>Dismissed</T>
                ) : (
                  new Date(item.hiddenUntil).toLocaleString()
                )}
              </span>
              <Button
                size="compact"
                variant="outline"
                onClick={async () =>
                  reportResult(
                    gt("Could not bring it back"),
                    await restore({
                      environmentId: machine.via,
                      input: { environmentId: machine.environmentId, key: item.key },
                    }),
                  )
                }
              >
                <T>Bring back</T>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
