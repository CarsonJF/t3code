import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  resolveTotAnimation,
  totFaceInputFromShell,
  totFaceState,
  type EnvironmentGroupChat,
  type EnvironmentTot,
} from "@t3tools/client-runtime/tots";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings } from "~/hooks/useSettings";
import { useThreadShell } from "~/state/entities";
import { useTots } from "~/state/tots";
import { TotAvatar } from "./TotAvatar";

/** The Tots in a group chat, in the order the chat lists them; members that are gone are skipped. */
export function useGroupChatMembers(entry: EnvironmentGroupChat): ReadonlyArray<EnvironmentTot> {
  const tots = useTots();
  return entry.room.memberIds.flatMap((id) => {
    const found = tots.find(
      (candidate) => candidate.environmentId === entry.environmentId && candidate.tot.id === id,
    );
    return found === undefined ? [] : [found];
  });
}

function MemberFace(props: { readonly member: EnvironmentTot; readonly size: number }) {
  const { environmentId, tot } = props.member;
  const animate = useClientSettings((settings) => settings.animateTotAvatars);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const shell = useThreadShell(
    tot.threadId === null ? null : scopeThreadRef(environmentId, tot.threadId),
  );
  return (
    <TotAvatar
      avatar={tot.avatar}
      state={totFaceState(totFaceInputFromShell(tot, shell))}
      animation={resolveTotAnimation("other", animate, reducedMotion)}
      size={props.size}
    />
  );
}

/** A group chat's face: its members' faces overlapped, each showing what that Tot is doing. */
export function GroupChatAvatar(props: {
  readonly members: ReadonlyArray<EnvironmentTot>;
  readonly size: number;
}) {
  const shown = props.members.slice(0, 3);
  const faceSize = Math.round(props.size * 0.72);
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center"
      style={{
        width: props.size + (shown.length - 1) * Math.round(faceSize * 0.5),
        height: props.size,
      }}
    >
      {shown.map((member, index) => (
        <span
          key={`${member.environmentId}:${member.tot.id}`}
          className="absolute"
          style={{ left: index * Math.round(faceSize * 0.5), zIndex: shown.length - index }}
        >
          <MemberFace member={member} size={faceSize} />
        </span>
      ))}
    </span>
  );
}
