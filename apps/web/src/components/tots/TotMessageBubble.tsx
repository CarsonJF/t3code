import type { ScopedThreadRef } from "@t3tools/contracts";
import { parseTotThreadId } from "@t3tools/contracts";
import type { EnvironmentTot } from "@t3tools/client-runtime/tots";
import type { ReactNode } from "react";

import { useTots } from "~/state/tots";
import { TotAvatar } from "./TotAvatar";
import { totTint, useTotAccent } from "./totAccent";

/** The Tot whose thread this is; its replies are drawn as that Tot's own. */
export function useTotThreadSpeaker(threadRef: ScopedThreadRef | null): EnvironmentTot | undefined {
  const tots = useTots();
  const totId = threadRef === null ? null : parseTotThreadId(threadRef.threadId);
  if (threadRef === null || totId === null) return undefined;
  return tots.find(
    (entry) => entry.environmentId === threadRef.environmentId && entry.tot.id === totId,
  );
}

/** A reply in the speaking Tot's color, with its face and name beside it. */
export function TotMessageBubble(props: {
  readonly speaker: EnvironmentTot;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { tot } = props.speaker;
  const accent = useTotAccent(tot.avatar);
  return (
    <div className="flex items-end gap-2.5" data-testid="tot-message" data-tot-id={tot.id}>
      <div className="pb-1">
        <TotAvatar avatar={tot.avatar} state="idle" animation="still" size={28} />
      </div>
      <div className="flex min-w-0 max-w-[min(100%,48rem)] flex-col gap-1">
        <span className="px-1 font-medium text-xs" style={{ color: accent }}>
          {tot.name}
        </span>
        <div
          className="min-w-0 rounded-2xl rounded-bl-md px-3.5 py-2"
          style={{
            backgroundColor: totTint(accent, 12),
            boxShadow: `inset 0 0 0 1px ${totTint(accent, 22)}`,
          }}
        >
          {props.children}
        </div>
        {props.footer}
      </div>
    </div>
  );
}
