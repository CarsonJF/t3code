import type { EnvironmentGroupChat } from "@t3tools/client-runtime/tots";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

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
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 px-4 pt-3 pb-2">
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-card px-4 py-1.5">
        <GroupChatAvatar members={members} size={28} />
        <span className="font-medium text-foreground text-sm">{room.name}</span>
      </div>
      <p className="text-center text-muted-foreground text-xs">
        {members.map((member) => member.tot.name).join(", ")}
        {moderator === undefined ? "" : `. ${moderator.tot.name} answers when you name no one`}
      </p>
    </div>
  );
}
