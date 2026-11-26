import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

/** Approve, decline or answer what a companion asked, through the server's proxy. */
export function CompanionNeedsYouActions(props: {
  readonly environmentId: EnvironmentId;
  readonly companionId: string;
  readonly needsYouId: string;
  readonly kind: "question" | "approval";
  readonly options: ReadonlyArray<string>;
}) {
  const gt = useGT();
  const respond = useAtomCommand(serverEnvironment.respondToCompanion, { reportFailure: false });
  const canRespond = useAtomValue(
    serverEnvironment.respondToCompanion.permissionAtom(props.environmentId),
  );
  const [answer, setAnswer] = useState("");
  const [pending, setPending] = useState(false);
  const send = async (decision: "accept" | "decline", text?: string) => {
    setPending(true);
    const result = await respond({
      environmentId: props.environmentId,
      input: {
        companionId: props.companionId,
        needsYouId: props.needsYouId,
        decision,
        ...(text === undefined ? {} : { answer: text }),
      },
    });
    setPending(false);
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: gt("Could not send the answer"),
      description: error instanceof Error ? error.message : String(error),
    });
  };
  const disabled = pending || !canRespond;
  if (props.kind === "approval") {
    return (
      <div className="flex gap-2" data-companion-needs-you-actions={props.needsYouId}>
        <Button size="compact" disabled={disabled} onClick={() => void send("accept")}>
          <T>Approve</T>
        </Button>
        <Button
          size="compact"
          variant="outline"
          disabled={disabled}
          onClick={() => void send("decline")}
        >
          <T>Decline</T>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-companion-needs-you-actions={props.needsYouId}>
      {props.options.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {props.options.map((option) => (
            <Button
              key={option}
              size="compact"
              variant="outline"
              disabled={disabled}
              onClick={() => void send("accept", option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = answer.trim();
          if (text === "") return;
          void send("accept", text).then(() => setAnswer(""));
        }}
      >
        <Input
          size="sm"
          value={answer}
          disabled={disabled}
          aria-label={gt("Your answer")}
          placeholder={gt("Type an answer")}
          onChange={(event) => setAnswer(event.target.value)}
        />
        <Button size="compact" type="submit" disabled={disabled || answer.trim() === ""}>
          <T>Send</T>
        </Button>
        <Button
          size="compact"
          variant="ghost-muted"
          disabled={disabled}
          onClick={() => void send("decline")}
        >
          <T>Decline</T>
        </Button>
      </form>
    </div>
  );
}
