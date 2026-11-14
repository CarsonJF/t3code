import {
  totFaceInputFromShell,
  totFaceState,
  type EnvironmentGroupChat,
} from "@t3tools/client-runtime/tots";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useThreadShells } from "~/state/entities";
import { useGroupChats } from "~/state/tots";
import { GroupChatAvatar, useGroupChatMembers } from "./GroupChatAvatar";

/** The group chat above its conversation: who is in the room, and how it answers. */
export function GroupChatHero(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const entry = useGroupChats().find(
    (candidate) =>
      candidate.environmentId === props.environmentId && candidate.room.threadId === props.threadId,
  );
  if (entry === undefined) return null;
  return <Hero entry={entry} />;
}

function Hero(props: { readonly entry: EnvironmentGroupChat }) {
  const { room } = props.entry;
  const members = useGroupChatMembers(props.entry);
  const moderator = members.find((member) => member.tot.id === room.moderatorId);
  const shells = useThreadShells();
  const working = members.filter(({ environmentId, tot }) => {
    const shell =
      shells.find(
        (candidate) => candidate.environmentId === environmentId && candidate.id === tot.threadId,
      ) ?? null;
    return totFaceState(totFaceInputFromShell(tot, shell)) === "working";
  });
  const workingNames = working.map((member) => member.tot.name);
  const workingLine =
    workingNames.length === 0
      ? null
      : `${workingNames.length > 1 ? `${workingNames.slice(0, -1).join(", ")} and ${workingNames.at(-1)}` : workingNames[0]} ${workingNames.length > 1 ? "are" : "is"} working…`;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 px-4 pt-3 pb-2">
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-1.5">
        <GroupChatAvatar members={members} size={28} />
        <span className="font-medium text-foreground text-sm">{room.name}</span>
      </div>
      <p className="text-center text-muted-foreground text-xs" aria-live="polite">
        {workingLine ?? null}
        {workingLine !== null ? null : members.map((member) => member.tot.name).join(", ")}
        {workingLine !== null || moderator === undefined
          ? ""
          : `. ${moderator.tot.name} answers when you name no one`}
      </p>
    </div>
  );
}
