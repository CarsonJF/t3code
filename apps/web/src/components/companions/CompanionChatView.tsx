import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EMPTY_CHANNEL_VIEW,
  companionAvatar,
  companionChannelChildId,
  companionFaceState,
  companionLinkedThreadTarget,
  companionResolutionText,
  withOlderMessages,
  type CompanionChannelView,
} from "@t3tools/client-runtime/companions";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  CompanionAvatar,
  CompanionLinkedThread,
  CompanionMessage,
  CompanionNeedsYou,
  CompanionToolCall,
  EnvironmentId,
  ExternalCompanionStatus,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { T, useGT, Var } from "gt-react";
import {
  CheckIcon,
  CircleDotIcon,
  MessageCircleQuestionIcon,
  MessagesSquareIcon,
  SendIcon,
  ShieldQuestionIcon,
  SquareArrowOutUpRightIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { isElectron } from "~/env";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { useClientSettings, useEnvironmentSettings } from "~/hooks/useSettings";
import { formatShortTimestamp } from "../../timestampFormat";
import { randomUUID } from "../../lib/utils";
import { linkedThreadRouteParams } from "../../linkedThreadSurface";
import { useCompanion } from "../../state/companions";
import { useThreadShell } from "../../state/entities";
import { useConnectedEnvironmentIds } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import ChatMarkdown from "../ChatMarkdown";
import { focusComposerAfterEntry } from "../chat/useFocusComposerOnThreadOpen";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ThemeEffect } from "../tots/TotThemeEffect";
import { ConversationHero } from "../tots/TotThreadHero";
import { ThemeSheet } from "../tots/TotThemeStyles";
import { CompanionFace } from "./CompanionFace";
import { CompanionNeedsYouActions } from "./CompanionNeedsYouActions";

function reportFailure(title: string, result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const error = squashAtomCommandFailure(result);
  toastManager.add({
    type: "error",
    title,
    description: error instanceof Error ? error.message : String(error),
  });
}

/** A companion's `main` channel or one child's, with its history, live replies and composer. */
export function CompanionChatView(props: {
  readonly environmentId: EnvironmentId;
  readonly companionId: string;
  readonly channel: string;
}) {
  const companion = useCompanion(props.environmentId, props.companionId);
  if (companion === undefined) {
    return (
      <SidebarInset className="h-dvh min-h-0">
        <Empty size="hero">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessagesSquareIcon />
            </EmptyMedia>
            <EmptyTitle>
              <T>This companion is not registered</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>Add it in Settings → External Companions.</T>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }
  return (
    <ConnectedChat
      key={`${props.environmentId}:${props.companionId}:${props.channel}`}
      environmentId={props.environmentId}
      companion={companion}
      channel={props.channel}
    />
  );
}

function ConnectedChat(props: {
  readonly environmentId: EnvironmentId;
  readonly companion: ExternalCompanionStatus;
  readonly channel: string;
}) {
  const { companion, environmentId, channel } = props;
  const gt = useGT();
  const childId = companionChannelChildId(channel);
  const child =
    childId === null
      ? undefined
      : companion.manifest?.children.find((entry) => entry.id === childId);
  const result = useAtomValue(
    serverEnvironment.companionChannel({
      environmentId,
      input: { companionId: companion.id, channel },
    }),
  );
  const snapshot = Option.getOrUndefined(AsyncResult.value(result));
  const view: CompanionChannelView = snapshot ?? EMPTY_CHANNEL_VIEW;
  const loadFailed = AsyncResult.isFailure(result);
  // The stream stays open after its snapshot, so an empty channel has loaded once one arrives.
  const loading = snapshot === undefined && !loadFailed;
  const [older, setOlder] = useState<{
    readonly messages: ReadonlyArray<CompanionMessage>;
    readonly cursor: string | null;
  } | null>(null);
  const loadHistory = useAtomCommand(serverEnvironment.companionHistory, { reportFailure: false });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursor = older === null ? view.nextCursor : older.cursor;
  const messages = withOlderMessages(older?.messages ?? [], view.messages);
  const online = companion.connection === "connected";
  const name = child?.name ?? companion.label;
  const faceSeed = child === undefined ? companion.id : `${companion.id}:${child.id}`;
  const avatarState = companion.avatarStates[childId ?? "main"];
  // Children wear the companion's theme; their CSS can target data-companion-channel.
  const theme = useEnvironmentSettings(
    environmentId,
    (settings) => settings.externalCompanions.find((entry) => entry.id === companion.id)?.theme,
  );
  const working = online && avatarState === "working";
  const loadOlder = async () => {
    if (cursor === null) return;
    setLoadingOlder(true);
    const page = await loadHistory({
      environmentId,
      input: { companionId: companion.id, channel, before: cursor },
    });
    setLoadingOlder(false);
    if (page._tag === "Success") {
      setOlder({
        messages: [...page.value.messages, ...(older?.messages ?? [])],
        cursor: page.value.nextCursor,
      });
    } else if (!isAtomCommandInterrupted(page)) {
      reportFailure(gt("Could not load older messages"), page);
    }
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
        data-companion-chat={channel}
      >
        <WorkspacePageHeader electron={isElectron} className="border-b">
          <CompanionFace
            avatar={child?.avatar ?? companion.manifest?.avatar}
            seed={faceSeed}
            state={avatarState}
            online={online}
            size={22}
          />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-sm font-medium">{name}</h1>
            {child === undefined ? (
              companion.manifest?.tagline ? (
                <p className="truncate text-xs text-muted-foreground">
                  {companion.manifest.tagline}
                </p>
              ) : null
            ) : (
              <p className="truncate text-xs text-muted-foreground">
                {child.role ?? companion.label}
              </p>
            )}
          </div>
          {online ? null : (
            <Badge variant="outline" className="ms-auto">
              {companion.connection === "connecting" ? <T>Connecting</T> : <T>Offline</T>}
            </Badge>
          )}
        </WorkspacePageHeader>
        {!online && companion.error !== null ? (
          <p className="border-b bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground">
            {companion.error}
          </p>
        ) : null}
        <div
          className="relative flex min-h-0 flex-1 flex-col bg-background"
          data-companion-id={companion.id}
          data-companion-channel={channel}
        >
          <ThemeSheet kind="companion" scopeId={companion.id} css={theme?.css} />
          <ThemeEffect
            frameKey={`${companion.id}:${channel}`}
            script={theme?.effect}
            context={{
              usedTokens: null,
              maxTokens: null,
              usedPercentage: null,
              working,
              phase: !online ? "disconnected" : working ? "running" : "ready",
            }}
          />
          <ConversationHero
            avatar={companionAvatar(child?.avatar ?? companion.manifest?.avatar, faceSeed)}
            name={name}
            state={companionFaceState(avatarState, online)}
          />
          <div className="messages-timeline-scroll flex min-h-0 flex-1 flex-col-reverse overflow-y-auto scrollbar-gutter-both">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
              {cursor !== null && messages.length > 0 ? (
                <Button
                  size="compact"
                  variant="ghost-muted"
                  className="self-center"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  <T>Load older messages</T>
                </Button>
              ) : null}
              {loading ? (
                <p className="text-center text-sm text-muted-foreground">
                  <T>Loading…</T>
                </p>
              ) : null}
              {loadFailed && messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">
                  <T>
                    The conversation could not be read. It loads again when the companion is back.
                  </T>
                </p>
              ) : null}
              {!loading && !loadFailed && messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">
                  <T>
                    No messages with <Var>{name}</Var> yet.
                  </T>
                </p>
              ) : null}
              {messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  streaming={view.streaming.has(message.id)}
                  environmentId={environmentId}
                  companion={companion}
                  childAvatar={child?.avatar}
                  faceSeed={faceSeed}
                />
              ))}
              {view.looseNeedsYou.map((needsYou) => (
                <NeedsYouCard
                  key={needsYou.id}
                  needsYou={needsYou}
                  environmentId={environmentId}
                  companionId={companion.id}
                />
              ))}
            </div>
          </div>
          <Composer
            environmentId={environmentId}
            companion={companion}
            channel={channel}
            name={name}
          />
        </div>
      </div>
    </SidebarInset>
  );
}

function MessageRow(props: {
  readonly message: CompanionMessage;
  readonly streaming: boolean;
  readonly environmentId: EnvironmentId;
  readonly companion: ExternalCompanionStatus;
  readonly childAvatar: CompanionAvatar | undefined;
  readonly faceSeed: string;
}) {
  const { message } = props;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  if (message.role === "system") {
    return (
      <div
        className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground"
        data-companion-message="system"
      >
        <ChatMarkdown text={message.text} cwd={undefined} parseRawHtml={false} />
      </div>
    );
  }
  const mine = message.role === "user";
  return (
    <div
      className={mine ? "flex flex-col items-end gap-1.5" : "flex gap-2.5"}
      data-companion-message={message.role}
    >
      {mine ? null : (
        <div className="mt-0.5 shrink-0">
          <CompanionFace
            avatar={props.childAvatar ?? props.companion.manifest?.avatar}
            seed={props.faceSeed}
            state={undefined}
            online
            size={24}
          />
        </div>
      )}
      <div
        className={
          mine
            ? "flex max-w-[85%] flex-col items-end gap-1.5"
            : "flex min-w-0 flex-1 flex-col gap-1.5"
        }
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <time dateTime={message.createdAt}>
            {formatShortTimestamp(message.createdAt, timestampFormat)}
          </time>
          {message.sourceSurface === undefined ? null : (
            <Badge variant="outline" size="sm" data-companion-source={message.sourceSurface}>
              {message.sourceSurface}
            </Badge>
          )}
        </div>
        {message.text === "" ? null : (
          <div
            className={mine ? "rounded-2xl bg-secondary px-3 py-2" : "min-w-0"}
            {...(mine ? { "data-user-message-bubble": "" } : {})}
          >
            <ChatMarkdown
              text={message.text}
              cwd={undefined}
              parseRawHtml={false}
              isStreaming={props.streaming}
            />
          </div>
        )}
        {message.toolCalls.length === 0 ? null : (
          <ul className="flex flex-col gap-1">
            {message.toolCalls.map((toolCall) => (
              <ToolCard key={toolCall.id} toolCall={toolCall} />
            ))}
          </ul>
        )}
        {message.linkedThreads.map((thread) => (
          <LinkedThreadCard
            key={thread.threadId}
            thread={thread}
            environmentId={props.environmentId}
          />
        ))}
        {message.needsYou.map((needsYou) => (
          <NeedsYouCard
            key={needsYou.id}
            needsYou={needsYou}
            environmentId={props.environmentId}
            companionId={props.companion.id}
          />
        ))}
      </div>
    </div>
  );
}

function ToolCard(props: { readonly toolCall: CompanionToolCall }) {
  const { toolCall } = props;
  const StatusIcon =
    toolCall.status === "done" ? CheckIcon : toolCall.status === "error" ? XIcon : CircleDotIcon;
  return (
    <li
      className="flex min-w-0 items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs"
      data-companion-tool={toolCall.status}
    >
      <WrenchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-mono font-medium">{toolCall.name}</span>
      {toolCall.summary === undefined ? null : (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{toolCall.summary}</span>
      )}
      <StatusIcon
        aria-label={toolCall.status}
        className={
          toolCall.status === "error"
            ? "ms-auto size-3.5 shrink-0 text-destructive-foreground"
            : toolCall.status === "done"
              ? "ms-auto size-3.5 shrink-0 text-success-foreground"
              : "ms-auto size-3.5 shrink-0 text-warning-foreground"
        }
      />
    </li>
  );
}

function LinkedThreadCard(props: {
  readonly thread: CompanionLinkedThread;
  readonly environmentId: EnvironmentId;
}) {
  const navigate = useNavigate();
  const connected = useConnectedEnvironmentIds();
  const target = companionLinkedThreadTarget(props.thread, props.environmentId);
  const shell = useThreadShell(
    target === null || !connected.includes(target.environmentId)
      ? null
      : scopeThreadRef(target.environmentId, target.threadId),
  );
  const title = shell?.title ?? props.thread.title ?? props.thread.threadId;
  const open = () => {
    if (target === null) return;
    if (connected.includes(target.environmentId)) {
      void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(target) });
      return;
    }
    // Another machine this companion's server links to: read through that server.
    void navigate({
      to: "/linked/$viaEnvironmentId/$linkedEnvironmentId/$linkedThreadId",
      params: linkedThreadRouteParams({ viaEnvironmentId: props.environmentId, ...target }),
    });
  };
  return (
    <button
      type="button"
      disabled={target === null}
      onClick={open}
      data-companion-linked-thread={props.thread.threadId}
      className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-left text-sm hover:bg-accent disabled:cursor-default disabled:opacity-60"
    >
      <SquareArrowOutUpRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
      {props.thread.status === undefined ? null : (
        <Badge variant="secondary" size="sm">
          {props.thread.status}
        </Badge>
      )}
    </button>
  );
}

function NeedsYouCard(props: {
  readonly needsYou: CompanionNeedsYou;
  readonly environmentId: EnvironmentId;
  readonly companionId: string;
}) {
  const { needsYou } = props;
  const pending = needsYou.status === "pending";
  const Icon = needsYou.kind === "approval" ? ShieldQuestionIcon : MessageCircleQuestionIcon;
  const resolved = companionResolutionText(needsYou.resolution);
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 data-[pending=false]:border-border data-[pending=false]:bg-card"
      data-pending={pending}
      data-companion-needs-you={needsYou.id}
    >
      <div className="flex items-start gap-2">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm">{needsYou.prompt}</p>
      </div>
      {pending ? (
        <CompanionNeedsYouActions
          environmentId={props.environmentId}
          companionId={props.companionId}
          needsYouId={needsYou.id}
          kind={needsYou.kind}
          options={needsYou.options ?? []}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {resolved === null ? (
            <T>Answered</T>
          ) : (
            <T>
              Answered: <Var>{resolved}</Var>
            </T>
          )}
        </p>
      )}
    </div>
  );
}

function Composer(props: {
  readonly environmentId: EnvironmentId;
  readonly companion: ExternalCompanionStatus;
  readonly channel: string;
  readonly name: string;
}) {
  const gt = useGT();
  const send = useAtomCommand(serverEnvironment.sendToCompanion, { reportFailure: false });
  const canSend = useAtomValue(
    serverEnvironment.sendToCompanion.permissionAtom(props.environmentId),
  );
  const [text, setText] = useState("");
  // Kept across a failed send so the retry is the same message to the companion.
  const [clientMessageId, setClientMessageId] = useState(() => randomUUID());
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Thread views skip entry focus on touch, where it would raise the keyboard.
  const isCoarsePointer = useMediaQuery({ pointer: "coarse" });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the composer on entry; the chat remounts per channel
  useEffect(
    () =>
      isCoarsePointer
        ? undefined
        : focusComposerAfterEntry(() => textareaRef.current?.focus({ preventScroll: true })),
    [isCoarsePointer],
  );
  const submit = async () => {
    const body = text.trim();
    if (body === "" || sending) return;
    setSending(true);
    const result = await send({
      environmentId: props.environmentId,
      input: {
        companionId: props.companion.id,
        channel: props.channel,
        text: body,
        clientMessageId,
      },
    });
    setSending(false);
    if (result._tag === "Success") {
      setText("");
      setClientMessageId(randomUUID());
    } else if (!isAtomCommandInterrupted(result)) {
      reportFailure(gt("Could not send the message"), result);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <form
      className="border-t bg-background px-4 py-3"
      data-slot="composer-host"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          rows={2}
          disabled={!canSend}
          aria-label={gt("Message {name}", { name: props.name })}
          placeholder={gt("Message {name}", { name: props.name })}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!canSend || sending || text.trim() === ""}
          aria-label={gt("Send")}
        >
          <SendIcon />
        </Button>
      </div>
    </form>
  );
}
