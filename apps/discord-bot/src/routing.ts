export interface TotView {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  /** Null until the Tot is turned on; a Tot with no thread cannot be messaged. */
  readonly threadId: string | null;
  readonly link: string | null;
}

export interface StickyTots {
  readonly get: (userId: string) => string | undefined;
  readonly set: (userId: string, totId: string) => void;
  readonly clear: (userId: string) => void;
}

/** Per-user routing target. Memory only: a restart falls back to the default Tot. */
export const createStickyTots = (): StickyTots => {
  const byUser = new Map<string, string>();
  return {
    get: (userId) => byUser.get(userId),
    set: (userId, totId) => {
      byUser.set(userId, totId);
    },
    clear: (userId) => {
      byUser.delete(userId);
    },
  };
};

const normalizeName = (name: string): string => name.trim().toLowerCase();

export const findTotByName = (tots: ReadonlyArray<TotView>, query: string): TotView | undefined => {
  const wanted = normalizeName(query);
  if (wanted.length === 0) return undefined;
  const byId = tots.find((tot) => tot.id === query.trim());
  if (byId !== undefined) return byId;
  const exact = tots.find((tot) => normalizeName(tot.name) === wanted);
  if (exact !== undefined) return exact;
  const prefixed = tots.filter((tot) => normalizeName(tot.name).startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] : undefined;
};

/** Autocomplete: prefix matches first, then any other substring match. */
export const autocompleteTots = (
  tots: ReadonlyArray<TotView>,
  query: string,
  limit = 25,
): ReadonlyArray<TotView> => {
  const wanted = normalizeName(query);
  const ranked = tots
    .map((tot) => ({ tot, name: normalizeName(tot.name) }))
    .filter(({ name }) => wanted.length === 0 || name.includes(wanted))
    .sort((left, right) => {
      const leftPrefix = left.name.startsWith(wanted) ? 0 : 1;
      const rightPrefix = right.name.startsWith(wanted) ? 0 : 1;
      if (leftPrefix !== rightPrefix) return leftPrefix - rightPrefix;
      return left.name.localeCompare(right.name);
    });
  return ranked.slice(0, limit).map(({ tot }) => tot);
};

export interface RouteContext {
  readonly tots: ReadonlyArray<TotView>;
  readonly sticky: StickyTots;
  readonly defaultName: string;
  readonly userId: string;
}

export type RouteDecision =
  | {
      readonly kind: "send";
      readonly tot: TotView;
      readonly text: string;
      readonly fresh: boolean;
    }
  | { readonly kind: "list" }
  | { readonly kind: "use"; readonly tot: TotView }
  | { readonly kind: "new"; readonly tot: TotView }
  | { readonly kind: "stop"; readonly tot: TotView }
  | { readonly kind: "unavailable"; readonly tot?: TotView; readonly message: string };

export type SlashCommand =
  | { readonly kind: "list" }
  | { readonly kind: "use"; readonly name: string }
  | { readonly kind: "new" }
  | { readonly kind: "stop" };

const namesOf = (tots: ReadonlyArray<TotView>): string =>
  tots
    .map((tot) => tot.name)
    .slice(0, 12)
    .join(", ");

const missingDefaultMessage = (context: RouteContext, wanted: string): string =>
  context.tots.length === 0
    ? "No Tots are set up on this T3 server yet. Create one in the app first."
    : `There is no Tot named ${wanted}. Pick one with /tot use <name>. Available: ${namesOf(context.tots)}.`;

const notRunningMessage = (tot: TotView): string =>
  `${tot.name} is not running. Turn it on in the app, then try again.${tot.link === null ? "" : `\n${tot.link}`}`;

export type TotResolution =
  | { readonly kind: "tot"; readonly tot: TotView }
  | { readonly kind: "unavailable"; readonly tot?: TotView; readonly message: string };

/** Sticky Tot when the user picked one, otherwise Home. */
export const resolveTot = (context: RouteContext): TotResolution => {
  const stickyId = context.sticky.get(context.userId);
  if (stickyId !== undefined) {
    const picked = context.tots.find((tot) => tot.id === stickyId);
    if (picked !== undefined) {
      return picked.threadId === null
        ? { kind: "unavailable", tot: picked, message: notRunningMessage(picked) }
        : { kind: "tot", tot: picked };
    }
  }
  const fallback = findTotByName(context.tots, context.defaultName);
  if (fallback === undefined) {
    return { kind: "unavailable", message: missingDefaultMessage(context, context.defaultName) };
  }
  return fallback.threadId === null
    ? { kind: "unavailable", tot: fallback, message: notRunningMessage(fallback) }
    : { kind: "tot", tot: fallback };
};

export const routeText = (
  context: RouteContext,
  text: string,
  options: { readonly freshTotIds?: ReadonlySet<string> } = {},
): RouteDecision => {
  const resolution = resolveTot(context);
  if (resolution.kind === "unavailable") return resolution;
  const tot = resolution.tot;
  if (text.trim().length === 0) {
    return { kind: "unavailable", tot, message: "That message was empty." };
  }
  return { kind: "send", tot, text, fresh: options.freshTotIds?.has(tot.id) ?? false };
};

export const routeCommand = (context: RouteContext, command: SlashCommand): RouteDecision => {
  if (command.kind === "list") return { kind: "list" };
  if (command.kind === "use") {
    const tot = findTotByName(context.tots, command.name);
    if (tot === undefined) {
      const known = namesOf(context.tots);
      return {
        kind: "unavailable",
        message:
          known.length === 0
            ? "No Tots are set up on this T3 server yet."
            : `No Tot matches ${command.name}. Available: ${known}.`,
      };
    }
    return { kind: "use", tot };
  }
  const tot = resolveTot(context);
  if (tot.kind === "unavailable") return tot;
  return command.kind === "new" ? { kind: "new", tot: tot.tot } : { kind: "stop", tot: tot.tot };
};
