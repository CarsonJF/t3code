import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  Tot,
  TotObjective,
  TotObjectiveAttempt,
  TotObjectiveStatus,
  TotWorkAction,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { useState } from "react";

import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ScheduledRelativeLabel } from "../settings/ScheduledTasksSettings";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { workListGroups } from "./totWorkSection.logic";

const STATUS_LABELS: Record<TotObjectiveStatus, string> = {
  planned: msg("Planned", { $context: "status of a Tot objective" }),
  working: msg("Working", { $context: "status of a Tot objective" }),
  waiting: msg("Waiting", { $context: "status of a Tot objective" }),
  needs_you: msg("Needs you", { $context: "status of a Tot objective" }),
  done: msg("Done", { $context: "status of a Tot objective" }),
  failed: msg("Failed", { $context: "status of a Tot objective" }),
  cancelled: msg("Cancelled", { $context: "status of a Tot objective" }),
};

const STATUS_VARIANTS: Record<
  TotObjectiveStatus,
  "outline" | "info" | "success" | "error" | "warning"
> = {
  planned: "outline",
  working: "info",
  waiting: "outline",
  needs_you: "warning",
  done: "success",
  failed: "error",
  cancelled: "outline",
};

/** A Tot's objectives and the threads that worked on each, live from its host. */
export function TotWorkSection(props: {
  readonly environmentId: EnvironmentId;
  readonly tot: Tot;
}) {
  const work = useEnvironmentQuery(
    serverEnvironment.totWorkLive({
      environmentId: props.environmentId,
      input: { id: props.tot.id },
    }),
  );
  const objectives = work.data?.objectives ?? [];
  const m = useMessages();
  return (
    <section className="flex flex-col gap-2.5">
      <div className="min-w-0">
        <h3 className="font-medium text-foreground text-sm">
          <T>Work</T>
        </h3>
        <p className="text-muted-foreground text-xs">
          <T>
            Objectives <Var>{props.tot.name}</Var> started work for. Status follows its threads.
          </T>
        </p>
      </div>
      {work.error !== null ? (
        <p className="text-destructive-foreground text-xs">
          <T>Could not load work:</T> {work.error}
        </p>
      ) : work.data === null ? (
        <p className="text-muted-foreground text-xs" role="status">
          <T>Loading work…</T>
        </p>
      ) : objectives.length === 0 ? (
        <div className="rounded-md border border-border/60 p-2.5">
          <p className="text-muted-foreground text-xs">
            <T>
              Nothing yet. Work <Var>{props.tot.name}</Var> launches with an objective shows here.
            </T>
          </p>
        </div>
      ) : (
        workListGroups(objectives).map((group) => (
          <div key={group.status} className="flex flex-col gap-1.5">
            <p className="text-muted-foreground text-xs">
              {m(STATUS_LABELS[group.status])} · {group.objectives.length}
            </p>
            <ul className="flex list-none flex-col gap-2 p-0">
              {group.objectives.map((objective) => (
                <TotObjectiveRow
                  key={objective.id}
                  environmentId={props.environmentId}
                  objective={objective}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function TotObjectiveRow(props: {
  readonly environmentId: EnvironmentId;
  readonly objective: TotObjective;
}) {
  const { objective } = props;
  const gt = useGT();
  const m = useMessages();
  const canOperate = useAtomValue(
    serverEnvironment.updateTotWork.permissionAtom(props.environmentId),
  );
  const update = useAtomCommand(serverEnvironment.updateTotWork, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const closed = objective.status === "done" || objective.status === "cancelled";
  const capped = objective.retryCap > 0 && objective.failedAttempts >= objective.retryCap;
  const outcome = objective.attempts.findLast((attempt) => attempt.outcome !== null)?.outcome;
  const threads = objective.attempts.filter(
    (attempt, index, all) =>
      all.findLastIndex(
        (other) =>
          other.environmentId === attempt.environmentId && other.threadId === attempt.threadId,
      ) === index,
  );
  const act = async (action: TotWorkAction) => {
    setPending(true);
    const result = await update({
      environmentId: props.environmentId,
      input: { id: objective.totId, objectiveId: objective.id, action },
    });
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not update {title}", { title: objective.title }),
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{objective.title}</span>
        <Badge variant={STATUS_VARIANTS[objective.status]}>
          {m(STATUS_LABELS[objective.status])}
        </Badge>
      </div>
      <p className="text-muted-foreground text-xs">
        {gt("{count, plural, one {{count} attempt} other {{count} attempts}}", {
          count: objective.attempts.length,
        })}
        {objective.failedAttempts === 0
          ? ""
          : ` · ${
              capped
                ? gt("{failed} failed, the limit is {cap}", {
                    failed: objective.failedAttempts,
                    cap: objective.retryCap,
                  })
                : gt("{failed} failed", { failed: objective.failedAttempts })
            }`}
        {" · "}
        <ScheduledRelativeLabel value={objective.updatedAt} />
      </p>
      {threads.length === 0 ? null : (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground text-xs">
          {threads.map((attempt) => (
            <AttemptThreadLink key={attempt.id} attempt={attempt} />
          ))}
        </div>
      )}
      {outcome == null ? null : (
        <p className="line-clamp-3 text-muted-foreground text-xs [overflow-wrap:anywhere]">
          {outcome}
        </p>
      )}
      {canOperate ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {objective.failedAttempts > 0 || closed ? (
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => void act("reset")}
            >
              {closed ? <T>Reopen</T> : <T>Reset attempts</T>}
            </Button>
          ) : null}
          {closed ? null : (
            <>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => void act("cancelled")}
              >
                <T>Cancel</T>
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => void act("done")}
              >
                <T>Mark done</T>
              </Button>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function AttemptThreadLink(props: { readonly attempt: TotObjectiveAttempt }) {
  const gt = useGT();
  const ref = scopeThreadRef(props.attempt.environmentId, props.attempt.threadId);
  const title = useQuietThreadShell(ref)?.title.trim();
  return (
    <Link
      to="/$environmentId/$threadId"
      params={buildThreadRouteParams(ref)}
      className="max-w-48 truncate underline underline-offset-2 hover:text-foreground"
    >
      {title || gt("Open thread")}
    </Link>
  );
}
