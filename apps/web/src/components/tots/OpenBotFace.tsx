import type { TotFaceState, TotOpenBotAvatar, TotOpenBotMaterial } from "@t3tools/contracts";
import type { AvatarDefinition, AvatarMaterial, AvatarMood, AvatarState } from "open-bot-avatar";
import type { MountedAvatar, mountAvatar } from "open-bot-avatar/dom";
import { useEffect, useRef, useState } from "react";

export interface OpenBotKit {
  readonly mountAvatar: typeof mountAvatar;
  /** Upstream's built-in examples, then its community gallery. */
  readonly figures: ReadonlyArray<AvatarDefinition>;
  /** Each finish; the renderer draws flat wherever one cannot run (no canvas, no WebGL2). */
  readonly materials: Readonly<Record<TotOpenBotMaterial, AvatarMaterial>>;
}

let loadedKit: OpenBotKit | null = null;
let kitLoad: Promise<OpenBotKit> | null = null;
export const loadOpenBot = () =>
  (kitLoad ??= Promise.all([
    import("open-bot-avatar"),
    import("open-bot-avatar/dom"),
    import("open-bot-avatar/gallery"),
    import("open-bot-avatar/materials/fluffy"),
    import("open-bot-avatar/materials/glass"),
    import("open-bot-avatar/materials/soft"),
  ]).then(([core, dom, more, fluffy, glass, soft]) => {
    const builtIn = new Set(core.examples.map((figure) => figure.id));
    loadedKit = {
      mountAvatar: dom.mountAvatar,
      figures: [...core.examples, ...more.gallery.filter((figure) => !builtIn.has(figure.id))],
      materials: { flat: "flat", fluffy: fluffy.fluffy, glass: glass.glass, soft: soft.soft },
    };
    return loadedKit;
  }));

/** The open-bot kit once loaded, or null while `wanted` is false or it is still loading. */
export function useOpenBotKit(wanted: boolean): OpenBotKit | null {
  const [kit, setKit] = useState(loadedKit);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the open-bot renderer the first time a face needs it
  useEffect(() => {
    if (!wanted || kit !== null) return;
    let cancelled = false;
    void loadOpenBot().then((loaded) => {
      if (!cancelled) setKit(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, kit]);
  return kit;
}

export const DEFAULT_OPEN_BOT: TotOpenBotAvatar = { figure: "chat" };

const OPEN_BOT_STATE: Record<TotFaceState, { state: AvatarState; mood: AvatarMood }> = {
  idle: { state: "idle", mood: "neutral" },
  working: { state: "working", mood: "neutral" },
  "needs-you": { state: "waiting", mood: "neutral" },
  success: { state: "done", mood: "happy" },
  failure: { state: "blocked", mood: "neutral" },
  sleep: { state: "idle", mood: "neutral" },
};

export function OpenBotFace(props: {
  readonly kit: OpenBotKit;
  readonly figure: AvatarDefinition;
  readonly look: TotOpenBotAvatar;
  readonly color: string;
  readonly state: TotFaceState;
  readonly moving: boolean;
  readonly size: number;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState<MountedAvatar | null>(null);
  const { state, mood } = OPEN_BOT_STATE[props.state];
  const { color, moving } = props;
  const { eyeColor, material, depth } = props.look;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- mounts the open-bot renderer into its host element
  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const avatar = props.kit.mountAvatar(element, {
      definition: props.figure,
      label: "",
      still: true,
    });
    setMounted(avatar);
    return () => {
      avatar.destroy();
      setMounted(null);
    };
  }, [props.kit, props.figure]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- passes color, look and state to the mounted renderer, also right after a remount
  useEffect(() => {
    mounted?.update({
      color,
      ...(eyeColor === undefined ? {} : { eyeColor }),
      material: props.kit.materials[material ?? "flat"],
      ...(depth === undefined ? {} : { depth }),
      state,
      mood,
      still: !moving,
    });
  }, [props.kit, mounted, color, eyeColor, material, depth, state, mood, moving]);

  return (
    <div
      ref={host}
      aria-hidden="true"
      data-tot-state={props.state}
      data-open-bot-figure={props.figure.id}
      style={{ display: "inline-block", width: props.size, height: props.size, flexShrink: 0 }}
    />
  );
}
