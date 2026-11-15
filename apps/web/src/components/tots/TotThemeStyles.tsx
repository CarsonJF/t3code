import {
  parseTotThreadId,
  type EnvironmentId,
  type ThreadId,
  type TotId,
  type TotTheme,
} from "@t3tools/contracts";
import { useEffect } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { applyTotThemeCss } from "./totThemeCss";

/**
 * Mounts the open Tot's own theme. ChatView renders it for every thread, so a
 * Tot thread applies here and navigating to any other thread, or to another
 * Tot, cleans the sheet up and applies the next one.
 */
export function TotThemeStyles(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const totId = parseTotThreadId(props.threadId);
  const tot = useEnvironmentSettings(props.environmentId, (settings) =>
    totId === null ? undefined : settings.tots.find((candidate) => candidate.id === totId),
  );
  return <TotThemeSheet totId={totId} theme={tot?.theme} />;
}

/** The sheet half of `TotThemeStyles`, called with the Tot record read live. */
export function TotThemeSheet(props: {
  readonly totId: TotId | null;
  readonly theme: TotTheme | undefined;
}) {
  const css = props.theme?.css;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps an adopted stylesheet in step with the open Tot thread until it unmounts
  useEffect(() => {
    if (props.totId === null || css === undefined || css === "") return;
    return applyTotThemeCss(props.totId, css);
  }, [props.totId, css]);
  return null;
}
