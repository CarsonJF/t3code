import { useAtomValue } from "@effect/atom-react";
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
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { TOT_FACE_STATE_LABELS } from "@t3tools/client-runtime/tots";
import {
  EnvironmentId,
  type CompanionAvatar,
  type CompanionLinkedThread,
  type CompanionMessage,
  type CompanionNeedsYou,
  type CompanionToolCall,
  type ExternalCompanionStatus,
} from "@t3tools/contracts";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import { parseTotThemeTokens, type TotThemeTokens } from "@t3tools/shared/totThemeTokens";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { T, useGT, useMessages } from "gt-react-native";
import { useMemo, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import { KeyboardAvoidingView, useKeyboardState } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { AppBar } from "../../components/ui/AppBar";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { cn } from "../../lib/cn";
import { tryOpenWebLink } from "../../lib/openExternalUrl";
import { relativeTime } from "../../lib/time";
import { uuidv4 } from "../../lib/uuid";
import { useCompanion } from "../../state/companions";
import { useThreadShell } from "../../state/entities";
import { connectedEnvironmentIdsAtom } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { NativeScrollViewMarker as ScrollViewMarker } from "../../native/NativeScrollViewMarker";
import { useOpenLinkedThread } from "../threads/useOpenLinkedThread";
import { TotLiveFace } from "../tots/TotLiveFace";
import { TotStatePill } from "../tots/TotStatePill";
import { totThemeColor } from "../tots/useTotThemeTokens";
import { useAnimateTotAvatars } from "../../state/tots";
import { CompanionStillFace } from "./CompanionsSection";

type CompanionRouteParams = {
  readonly environmentId: string;
  readonly companionId: string;
  readonly channel?: string;
};

const NO_TOKENS: TotThemeTokens = {};

/** A companion's `main` channel or one child's: its history, live replies and composer. */
export function CompanionRouteScreen({ route }: StaticScreenProps<CompanionRouteParams>) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const channel = route.params.channel ?? "main";
  const companion = useCompanion(environmentId, route.params.companionId);
  const navigation = useNavigation();
  const gt = useGT();
  if (companion === undefined) {
    return (
      <View className="flex-1 bg-screen">
        <AppBar title={gt("External Companion")} onBack={() => navigation.goBack()} />
        <EmptyState
          variant="plain"
          title={gt("This companion is not registered")}
          detail={gt("Add it in Settings → External Companions.")}
        />
      </View>
    );
  }
  return (
    <CompanionChat
      key={`${environmentId}:${companion.id}:${channel}`}
      environmentId={environmentId}
      companion={companion}
      channel={channel}
    />
  );
}

function CompanionChat(props: {
  readonly environmentId: EnvironmentId;
  readonly companion: ExternalCompanionStatus;
  readonly channel: string;
}) {
  const { companion, environmentId, channel } = props;
  const gt = useGT();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const bottomInset = keyboardVisible ? 8 : Math.max(insets.bottom, 12);
  const [composerHeight, setComposerHeight] = useState(64);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const atBottom = useRef(true);
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
  const loadHistory = useAtomCommand(serverEnvironment.companionHistory, {
    label: gt("Load older messages"),
  });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const cursor = older === null ? view.nextCursor : older.cursor;
  const messages = withOlderMessages(older?.messages ?? [], view.messages);
  const online = companion.connection === "connected";
  const name = child?.name ?? companion.label;
  const faceSeed = child === undefined ? companion.id : `${companion.id}:${child.id}`;
  const avatar = child?.avatar ?? companion.manifest?.avatar;
  const settings = useAtomValue(serverEnvironment.settingsValueAtom(environmentId));
  // Children wear the companion's theme, as on web.
  const themeCss = settings?.externalCompanions.find((entry) => entry.id === companion.id)?.theme
    ?.css;
  const tokens = useMemo(
    () => (themeCss === undefined ? NO_TOKENS : parseTotThemeTokens(themeCss).tokens),
    [themeCss],
  );
  const loadOlder = async () => {
    if (cursor === null) return;
    setLoadingOlder(true);
    const page = await loadHistory({
      environmentId,
      input: { companionId: companion.id, channel, before: cursor },
    });
    setLoadingOlder(false);
    if (page._tag !== "Success") return;
    // Older pages land above; keep the reader where they were rather than jumping to the end.
    atBottom.current = false;
    setOlder({
      messages: [...page.value.messages, ...(older?.messages ?? [])],
      cursor: page.value.nextCursor,
    });
  };
  const subtitle =
    child === undefined ? (companion.manifest?.tagline ?? null) : (child.role ?? companion.label);
  return (
    <KeyboardAvoidingView
      automaticOffset
      behavior="height"
      className="flex-1 bg-screen"
      style={tokens["--tot-bg"] === undefined ? undefined : { backgroundColor: tokens["--tot-bg"] }}
      testID={`companion-chat-${channel}`}
    >
      <AppBar
        title={name}
        subtitle={
          online
            ? subtitle
            : companion.connection === "connecting"
              ? gt("Connecting")
              : gt("Offline")
        }
        onBack={() => navigation.goBack()}
      />
      <CompanionHero
        avatar={companionAvatar(avatar, faceSeed)}
        name={name}
        state={companionFaceState(companion.avatarStates[childId ?? "main"], online)}
        tokens={tokens}
      />
      {!online && companion.error !== null ? (
        <Text className="border-b border-separator bg-subtle px-4 py-1.5 text-xs text-foreground-muted">
          {companion.error}
        </Text>
      ) : null}
      <ScrollViewMarker style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            atBottom.current =
              contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (atBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
          }}
          contentContainerStyle={{
            padding: 16,
            gap: 16,
            paddingBottom: composerHeight + bottomInset + 16,
          }}
        >
          {cursor !== null && messages.length > 0 ? (
            <View className="items-center">
              <Button
                size="compact"
                tone="text"
                label={loadingOlder ? gt("Loading…") : gt("Load older messages")}
                disabled={loadingOlder}
                onPress={() => void loadOlder()}
              />
            </View>
          ) : null}
          {loading ? (
            <Text className="text-center text-sm text-foreground-muted">
              <T>Loading…</T>
            </Text>
          ) : null}
          {loadFailed && messages.length === 0 ? (
            <Text className="text-center text-sm text-foreground-muted">
              <T>The conversation could not be read. It loads again when the companion is back.</T>
            </Text>
          ) : null}
          {!loading && !loadFailed && messages.length === 0 ? (
            <Text className="text-center text-sm text-foreground-muted">
              {gt("No messages with {name} yet.", { name })}
            </Text>
          ) : null}
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              streaming={view.streaming.has(message.id)}
              environmentId={environmentId}
              companion={companion}
              avatar={avatar}
              faceSeed={faceSeed}
              tokens={tokens}
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
        </ScrollView>
      </ScrollViewMarker>
      <Composer
        environmentId={environmentId}
        companionId={companion.id}
        channel={channel}
        name={name}
        bottomInset={bottomInset}
        onHeight={setComposerHeight}
        onSent={() => {
          atBottom.current = true;
        }}
      />
    </KeyboardAvoidingView>
  );
}

/** The face band a Tot thread shows on mobile, with the companion's live mood. */
function CompanionHero(props: {
  readonly avatar: ReturnType<typeof companionAvatar>;
  readonly name: string;
  readonly state: ReturnType<typeof companionFaceState>;
  readonly tokens: TotThemeTokens;
}) {
  const animate = useAnimateTotAvatars();
  const accent = props.avatar.color;
  const textColor = props.tokens["--tot-text"];
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={`${props.name}, ${TOT_FACE_STATE_LABELS[props.state]}`}
      testID="companion-hero"
      className={cn(
        "border-b border-separator",
        Platform.OS === "android" ? "bg-thread-canvas" : "bg-screen",
      )}
      style={
        props.tokens["--tot-border"] === undefined
          ? undefined
          : { borderBottomColor: props.tokens["--tot-border"] }
      }
    >
      {props.tokens["--tot-bg"] === undefined ? null : (
        <View
          pointerEvents="none"
          className="absolute inset-0"
          style={{ backgroundColor: props.tokens["--tot-bg"] }}
        />
      )}
      <View
        pointerEvents="none"
        className="absolute inset-0"
        style={{ backgroundColor: `${accent}14` }}
      />
      <View className="flex-row items-center gap-3 px-4 py-2.5">
        <View
          className="items-center justify-center"
          style={{ padding: 6, borderRadius: 32, backgroundColor: `${accent}21` }}
        >
          <TotLiveFace avatar={props.avatar} state={props.state} size={42} animate={animate} />
        </View>
        <View className="min-w-0 flex-1 justify-center gap-1">
          <Text
            numberOfLines={1}
            className="font-t3-semibold text-lg text-foreground"
            style={textColor === undefined ? undefined : { color: textColor }}
          >
            {props.name}
          </Text>
          <View className="flex-row">
            <TotStatePill size="band" state={props.state} accent={accent} />
          </View>
        </View>
      </View>
    </View>
  );
}

function MessageRow(props: {
  readonly message: CompanionMessage;
  readonly streaming: boolean;
  readonly environmentId: EnvironmentId;
  readonly companion: ExternalCompanionStatus;
  readonly avatar: CompanionAvatar | undefined;
  readonly faceSeed: string;
  readonly tokens: TotThemeTokens;
}) {
  const { message, tokens } = props;
  const gt = useGT();
  const messages = useMessages();
  const styles = useMarkdownPreviewStyles();
  const openThread = useOpenLinkedThread();
  const textStyle = {
    ...styles.nativeTextStyle,
    color: totThemeColor(tokens, "--tot-text", styles.nativeTextStyle.color),
    strongColor: totThemeColor(tokens, "--tot-text", styles.nativeTextStyle.strongColor),
    linkColor: totThemeColor(tokens, "--tot-accent", styles.nativeTextStyle.linkColor),
    mutedColor: totThemeColor(tokens, "--tot-muted", styles.nativeTextStyle.mutedColor),
  };
  const onLinkPress = (href: string) => {
    const link = parseThreadLinkHref(href);
    if (link === null) {
      void tryOpenWebLink(href, "markdown-link");
      return;
    }
    openThread({
      environmentId: link.environmentId ?? props.environmentId,
      threadId: link.threadId,
    });
  };
  const markdown = (
    <SelectableMarkdownText
      markdown={message.text}
      textStyle={textStyle}
      onLinkPress={onLinkPress}
    />
  );
  if (message.role === "system") {
    return (
      <View className="items-center px-6" testID="companion-message-system">
        <Text className="text-center text-xs text-foreground-muted">{message.text}</Text>
      </View>
    );
  }
  const mine = message.role === "user";
  const meta = (
    <View className="flex-row items-center gap-1.5">
      <Text className="text-2xs text-foreground-tertiary">
        {relativeTime(message.createdAt, undefined, messages)}
      </Text>
      {message.sourceSurface === undefined ? null : (
        <View className="rounded-full border border-border px-1.5">
          <Text className="text-2xs text-foreground-tertiary">{message.sourceSurface}</Text>
        </View>
      )}
      {props.streaming ? (
        <Text className="text-2xs text-foreground-tertiary">{gt("Replying…")}</Text>
      ) : null}
    </View>
  );
  if (mine) {
    return (
      <View className="items-end gap-1.5" testID="companion-message-user">
        {meta}
        {message.text === "" ? null : (
          <View
            className="max-w-[85%] rounded-3xl bg-user-bubble px-4 py-2.5"
            style={
              tokens["--tot-surface"] === undefined
                ? undefined
                : { backgroundColor: tokens["--tot-surface"] }
            }
          >
            {markdown}
          </View>
        )}
      </View>
    );
  }
  return (
    <View className="flex-row gap-2.5" testID="companion-message-assistant">
      <View className="mt-0.5">
        <CompanionStillFace
          avatar={props.avatar}
          seed={props.faceSeed}
          state={undefined}
          online
          size={24}
        />
      </View>
      <View className="min-w-0 flex-1 gap-2">
        {meta}
        {message.text === "" ? null : markdown}
        {message.toolCalls.map((toolCall) => (
          <ToolRow key={toolCall.id} toolCall={toolCall} />
        ))}
        {message.linkedThreads.map((thread) => (
          <LinkedThreadRow
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
      </View>
    </View>
  );
}

function ToolRow(props: { readonly toolCall: CompanionToolCall }) {
  const { toolCall } = props;
  const status =
    toolCall.status === "done"
      ? { icon: "checkmark.circle" as const, tint: "accent-success-foreground" }
      : toolCall.status === "error"
        ? { icon: "xmark.circle.fill" as const, tint: "accent-danger-foreground" }
        : { icon: "circle.dashed" as const, tint: "accent-warning-foreground" };
  return (
    <View
      testID={`companion-tool-${toolCall.status}`}
      accessible
      accessibilityLabel={`${toolCall.name}, ${toolCall.status}`}
      className="flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
    >
      <SymbolView
        name="wrench.and.screwdriver"
        size={13}
        tintColorClassName="accent-foreground-muted"
        type="monochrome"
      />
      <Text numberOfLines={1} className="shrink-0 font-mono text-xs font-t3-medium text-foreground">
        {toolCall.name}
      </Text>
      <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground-muted">
        {toolCall.summary ?? ""}
      </Text>
      <SymbolView name={status.icon} size={14} tintColorClassName={status.tint} type="monochrome" />
    </View>
  );
}

function LinkedThreadRow(props: {
  readonly thread: CompanionLinkedThread;
  readonly environmentId: EnvironmentId;
}) {
  const openThread = useOpenLinkedThread();
  const connected = useAtomValue(connectedEnvironmentIdsAtom);
  const target = companionLinkedThreadTarget(props.thread, props.environmentId);
  // A thread on a machine this phone is not connected to cannot open here.
  const reachable = target !== null && connected.includes(target.environmentId);
  const shell = useThreadShell(
    reachable ? scopeThreadRef(target.environmentId, target.threadId) : null,
  );
  const title = shell?.title ?? props.thread.title ?? props.thread.threadId;
  return (
    <Pressable
      testID={`companion-linked-thread-${props.thread.threadId}`}
      accessibilityRole="link"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !reachable }}
      disabled={!reachable}
      onPress={() => {
        if (target !== null) openThread(target);
      }}
      className={cn(
        "flex-row items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5",
        !reachable && "opacity-60",
      )}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : undefined })}
    >
      <SymbolView
        name="arrow.up.right"
        size={12}
        tintColorClassName="accent-foreground-muted"
        type="monochrome"
      />
      <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-t3-medium text-foreground">
        {title}
      </Text>
      {props.thread.status === undefined ? null : (
        <View className="rounded-full bg-subtle px-2 py-0.5">
          <Text className="text-2xs text-foreground-secondary">{props.thread.status}</Text>
        </View>
      )}
    </Pressable>
  );
}

function NeedsYouCard(props: {
  readonly needsYou: CompanionNeedsYou;
  readonly environmentId: EnvironmentId;
  readonly companionId: string;
}) {
  const { needsYou } = props;
  const gt = useGT();
  const pending = needsYou.status === "pending";
  const resolved = companionResolutionText(needsYou.resolution);
  return (
    <View
      testID={`companion-needs-you-${needsYou.id}`}
      className={cn(
        "gap-3 rounded-2xl border px-3.5 py-3",
        pending ? "border-warning/40 bg-warning/5" : "border-border bg-card",
      )}
    >
      <View className="flex-row items-start gap-2">
        <SymbolView
          name={needsYou.kind === "approval" ? "exclamationmark.shield" : "questionmark.bubble"}
          size={16}
          tintColorClassName="accent-foreground-muted"
          type="monochrome"
        />
        <Text selectable className="min-w-0 flex-1 text-sm text-foreground">
          {needsYou.prompt}
        </Text>
      </View>
      {pending ? (
        <NeedsYouActions
          environmentId={props.environmentId}
          companionId={props.companionId}
          needsYou={needsYou}
        />
      ) : (
        <Text className="text-xs text-foreground-muted">
          {resolved === null ? gt("Answered") : gt("Answered: {answer}", { answer: resolved })}
        </Text>
      )}
    </View>
  );
}

/** Approve, decline or answer what a companion asked, through the server's proxy. */
function NeedsYouActions(props: {
  readonly environmentId: EnvironmentId;
  readonly companionId: string;
  readonly needsYou: CompanionNeedsYou;
}) {
  const gt = useGT();
  const respond = useAtomCommand(serverEnvironment.respondToCompanion, {
    label: gt("Could not send the answer"),
  });
  const canRespond = useAtomValue(
    serverEnvironment.respondToCompanion.permissionAtom(props.environmentId),
  );
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const send = async (decision: "accept" | "decline", text?: string) => {
    setSending(true);
    const result = await respond({
      environmentId: props.environmentId,
      input: {
        companionId: props.companionId,
        needsYouId: props.needsYou.id,
        decision,
        ...(text === undefined ? {} : { answer: text }),
      },
    });
    setSending(false);
    if (result._tag === "Success") setAnswer("");
  };
  const disabled = sending || !canRespond;
  if (props.needsYou.kind === "approval") {
    return (
      <View className="flex-row gap-2">
        <Button
          size="compact"
          tone="primary"
          label={gt("Approve")}
          disabled={disabled}
          onPress={() => void send("accept")}
        />
        <Button
          size="compact"
          tone="secondary"
          label={gt("Decline")}
          disabled={disabled}
          onPress={() => void send("decline")}
        />
      </View>
    );
  }
  const options = props.needsYou.options ?? [];
  return (
    <View className="gap-2">
      {options.length === 0 ? null : (
        <View className="flex-row flex-wrap gap-2">
          {options.map((option) => (
            <Button
              key={option}
              size="compact"
              tone="secondary"
              label={option}
              disabled={disabled}
              onPress={() => void send("accept", option)}
            />
          ))}
        </View>
      )}
      <TextInput
        accessibilityLabel={gt("Your answer")}
        placeholder={gt("Type an answer")}
        placeholderTextColorClassName="accent-foreground-muted"
        value={answer}
        onChangeText={setAnswer}
        editable={!disabled}
        className="min-h-10 rounded-xl border border-border bg-screen px-3 py-2 text-sm text-foreground"
      />
      <View className="flex-row gap-2">
        <Button
          size="compact"
          tone="primary"
          label={gt("Send")}
          disabled={disabled || answer.trim() === ""}
          onPress={() => void send("accept", answer.trim())}
        />
        <Button
          size="compact"
          tone="text"
          label={gt("Decline")}
          disabled={disabled}
          onPress={() => void send("decline")}
        />
      </View>
    </View>
  );
}

/**
 * The companion composer. Like the thread composer on mobile it does not take focus on open,
 * which would raise the keyboard over the conversation; web skips it on touch for the same reason.
 */
function Composer(props: {
  readonly environmentId: EnvironmentId;
  readonly companionId: string;
  readonly channel: string;
  readonly name: string;
  readonly bottomInset: number;
  readonly onHeight: (height: number) => void;
  readonly onSent: () => void;
}) {
  const gt = useGT();
  const send = useAtomCommand(serverEnvironment.sendToCompanion, {
    label: gt("Could not send the message"),
  });
  const canSend = useAtomValue(
    serverEnvironment.sendToCompanion.permissionAtom(props.environmentId),
  );
  const [text, setText] = useState("");
  // Kept across a failed send so the retry is the same message to the companion.
  const [clientMessageId, setClientMessageId] = useState(() => uuidv4());
  const [sending, setSending] = useState(false);
  const submit = async () => {
    const body = text.trim();
    if (body === "" || sending) return;
    setSending(true);
    const result = await send({
      environmentId: props.environmentId,
      input: {
        companionId: props.companionId,
        channel: props.channel,
        text: body,
        clientMessageId,
      },
    });
    setSending(false);
    if (result._tag !== "Success") return;
    setText("");
    setClientMessageId(uuidv4());
    props.onSent();
  };
  const placeholder = gt("Message {name}", { name: props.name });
  return (
    <View
      className="absolute inset-x-4 bottom-0"
      style={{ paddingBottom: props.bottomInset }}
      testID="companion-composer"
    >
      <GlassSurface
        chrome="none"
        onLayout={(event) => props.onHeight(event.nativeEvent.layout.height)}
        className="flex-row items-end gap-1 p-1"
      >
        <TextInput
          accessibilityLabel={placeholder}
          multiline
          maxLength={100_000}
          placeholder={placeholder}
          placeholderTextColorClassName="accent-foreground-muted"
          value={text}
          onChangeText={setText}
          editable={canSend && !sending}
          className="max-h-36 min-h-12 min-w-0 flex-1 rounded-[24px] border-0 bg-transparent px-4 py-3 text-base text-foreground"
        />
        <View>
          <Button
            label={gt("Send")}
            tone="contrast"
            disabled={!canSend || sending || text.trim() === ""}
            onPress={() => void submit()}
          />
        </View>
      </GlassSurface>
    </View>
  );
}
