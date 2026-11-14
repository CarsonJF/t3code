import {
  isGroupChatThreadId,
  parseTotThreadId,
  type OrchestrationV2Actor,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
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

export type RoomSpeakerView =
  | { readonly kind: "tot"; readonly entry: EnvironmentTot }
  | { readonly kind: "notice" };

/**
 * Who spoke a message in a group chat: the Tot whose thread sent it, or a notice from T3 Code.
 * Undefined outside a room and for the user's own messages, which keep their usual look.
 */
export function useRoomSpeaker(
  threadRef: ScopedThreadRef | null,
  message: {
    readonly senderThreadId?: ThreadId | undefined;
    readonly createdBy?: OrchestrationV2Actor | undefined;
  },
): RoomSpeakerView | undefined {
  const tots = useTots();
  if (threadRef === null || !isGroupChatThreadId(threadRef.threadId)) return undefined;
  if (message.createdBy === "system") return { kind: "notice" };
  const totId =
    message.senderThreadId === undefined ? null : parseTotThreadId(message.senderThreadId);
  if (totId === null) return undefined;
  const entry = tots.find(
    (candidate) =>
      candidate.environmentId === threadRef.environmentId && candidate.tot.id === totId,
  );
  return entry === undefined ? undefined : { kind: "tot", entry };
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
