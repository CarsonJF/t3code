export interface TotView {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  /** Null until the Tot is turned on; a Tot with no thread cannot be messaged. */
  readonly threadId: string | null;
  readonly link: string | null;
  /** The machine this Tot lives on. Even one machine has a label. */
  readonly environment: string;
}

/** A Tot's address: its id is only unique within one machine. */
export interface TotRef {
  readonly environment: string;
  readonly totId: string;
}

/** The identity of a Tot across machines, for sticky picks and fresh sessions. */
export const totKey = (tot: TotView): string => `${tot.environment}:${tot.id}`;

export const sameTot = (tot: TotView, ref: TotRef): boolean =>
  tot.environment === ref.environment && tot.id === ref.totId;

export interface EnvironmentFailure {
  readonly environment: string;
  readonly reason: string;
}

export interface StickyTots {
  readonly get: (userId: string) => string | undefined;
  readonly set: (userId: string, totKey: string) => void;
  readonly clear: (userId: string) => void;
}

/** Per-user routing target. Memory only: a restart falls back to the default Tot. */
export const createStickyTots = (): StickyTots => {
  const byUser = new Map<string, string>();
  return {
    get: (userId) => byUser.get(userId),
    set: (userId, totKey) => {
      byUser.set(userId, totKey);
    },
    clear: (userId) => {
      byUser.delete(userId);
    },
  };
};

const normalizeName = (name: string): string => name.trim().toLowerCase();

/** `machine:Tot` picks one machine; a bare name never does. */
const splitTotQuery = (
  query: string,
): { readonly environment: string | null; readonly name: string } => {
  const trimmed = query.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0 || colon === trimmed.length - 1) return { environment: null, name: trimmed };
  return {
    environment: trimmed.slice(0, colon).trim(),
    name: trimmed.slice(colon + 1).trim(),
  };
};

const matchingTot = (tots: ReadonlyArray<TotView>, query: string): TotView | undefined => {
  const wanted = normalizeName(query);
  if (wanted.length === 0) return undefined;
  const byId = tots.find((tot) => tot.id === query.trim());
  if (byId !== undefined) return byId;
  const exact = tots.find((tot) => normalizeName(tot.name) === wanted);
  if (exact !== undefined) return exact;
  const prefixed = tots.filter((tot) => normalizeName(tot.name).startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] : undefined;
};

export const findTotByName = (tots: ReadonlyArray<TotView>, query: string): TotView | undefined => {
  const parsed = splitTotQuery(query);
  if (parsed.environment === null) return matchingTot(tots, parsed.name);
  const scoped = tots.filter(
    (tot) => normalizeName(tot.environment) === normalizeName(parsed.environment!),
  );
  return scoped.length === 0 ? undefined : matchingTot(scoped, parsed.name);
};

/** The other machines holding a Tot with the same name, so a pick can say so. */
const otherEnvironmentsWithName = (
  tots: ReadonlyArray<TotView>,
  picked: TotView,
): ReadonlyArray<string> => [
  ...new Set(
    tots
      .filter(
        (tot) =>
          tot.environment !== picked.environment &&
          normalizeName(tot.name) === normalizeName(picked.name),
      )
      .map((tot) => tot.environment),
  ),
];

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
  /** Machines that could not be read on this refresh, so a pick can explain itself. */
  readonly failures?: ReadonlyArray<EnvironmentFailure>;
  /** Whether to name the machine in user-facing text. Off for the single form. */
  readonly multiEnvironment?: boolean;
}

export type RouteDecision =
  | {
      readonly kind: "send";
      readonly tot: TotView;
      readonly text: string;
      readonly fresh: boolean;
    }
  | { readonly kind: "list" }
  | {
      readonly kind: "use";
      readonly tot: TotView;
      /** Other machines with a Tot of the same name, when the query did not name one. */
      readonly alsoOn?: ReadonlyArray<string>;
    }
  | { readonly kind: "new"; readonly tot: TotView }
  | { readonly kind: "stop"; readonly tot: TotView }
  | { readonly kind: "unavailable"; readonly tot?: TotView; readonly message: string };

export type SlashCommand =
  | { readonly kind: "list" }
  | { readonly kind: "use"; readonly name: string }
  | { readonly kind: "new" }
  | { readonly kind: "stop" };

export const describeTot = (tot: TotView, multiEnvironment: boolean | undefined): string =>
  multiEnvironment === true ? `${tot.name} on ${tot.environment}` : tot.name;

const namesOf = (context: RouteContext): string =>
  context.tots
    .map((tot) => (context.multiEnvironment === true ? `${tot.environment}:${tot.name}` : tot.name))
    .slice(0, 12)
    .join(", ");

const missingDefaultMessage = (context: RouteContext, wanted: string): string =>
  context.tots.length === 0
    ? context.multiEnvironment === true
      ? "No Tots are set up on these machines yet. Create one in the app first."
      : "No Tots are set up on this T3 server yet. Create one in the app first."
    : `There is no Tot named ${wanted}. Pick one with /tot use <name>. Available: ${namesOf(context)}.`;

const notRunningMessage = (tot: TotView): string =>
  `${tot.name} is not running. Turn it on in the app, then try again.${tot.link === null ? "" : `\n${tot.link}`}`;

export type TotResolution =
  | { readonly kind: "tot"; readonly tot: TotView }
  | { readonly kind: "unavailable"; readonly tot?: TotView; readonly message: string };

/** Sticky Tot when the user picked one, otherwise Home. */
export const resolveTot = (context: RouteContext): TotResolution => {
  const stickyKey = context.sticky.get(context.userId);
  if (stickyKey !== undefined) {
    const picked = context.tots.find((tot) => totKey(tot) === stickyKey);
    if (picked !== undefined) {
      return picked.threadId === null
        ? { kind: "unavailable", tot: picked, message: notRunningMessage(picked) }
        : { kind: "tot", tot: picked };
    }
    const failed = context.failures?.find((failure) =>
      stickyKey.startsWith(`${failure.environment}:`),
    );
    if (failed !== undefined) {
      return {
        kind: "unavailable",
        message: `Could not reach ${failed.environment}: ${failed.reason}`,
      };
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
  options: { readonly freshTotKeys?: ReadonlySet<string> } = {},
): RouteDecision => {
  const resolution = resolveTot(context);
  if (resolution.kind === "unavailable") return resolution;
  const tot = resolution.tot;
  if (text.trim().length === 0) {
    return { kind: "unavailable", tot, message: "That message was empty." };
  }
  return { kind: "send", tot, text, fresh: options.freshTotKeys?.has(totKey(tot)) ?? false };
};

/**
 * A guild channel's Tot is fixed by the channel and its machine, so its address
 * chooses the Tot instead of the sticky pick or Home.
 */
export const routeToTot = (
  tots: ReadonlyArray<TotView>,
  ref: TotRef,
  text: string,
  options: {
    readonly freshTotKeys?: ReadonlySet<string>;
    readonly multiEnvironment?: boolean;
  } = {},
): RouteDecision => {
  const tot = tots.find((candidate) => sameTot(candidate, ref));
  if (tot === undefined) {
    return {
      kind: "unavailable",
      message:
        options.multiEnvironment === true
          ? `There is no Tot ${ref.totId} on ${ref.environment}.`
          : `There is no Tot ${ref.totId} on this T3 server.`,
    };
  }
  if (tot.threadId === null) {
    return { kind: "unavailable", tot, message: notRunningMessage(tot) };
  }
  if (text.trim().length === 0) {
    return { kind: "unavailable", tot, message: "That message was empty." };
  }
  return { kind: "send", tot, text, fresh: options.freshTotKeys?.has(totKey(tot)) ?? false };
};

export const routeCommand = (context: RouteContext, command: SlashCommand): RouteDecision => {
  if (command.kind === "list") return { kind: "list" };
  if (command.kind === "use") {
    const tot = findTotByName(context.tots, command.name);
    if (tot === undefined) {
      const known = namesOf(context);
      return {
        kind: "unavailable",
        message:
          known.length === 0
            ? context.multiEnvironment === true
              ? "No Tots are set up on these machines yet."
              : "No Tots are set up on this T3 server yet."
            : `No Tot matches ${command.name}. Available: ${known}.`,
      };
    }
    const parsed = splitTotQuery(command.name);
    const namedMachine =
      parsed.environment !== null &&
      context.tots.some(
        (candidate) => normalizeName(candidate.environment) === normalizeName(parsed.environment!),
      );
    const alsoOn = namedMachine ? [] : otherEnvironmentsWithName(context.tots, tot);
    return { kind: "use", tot, ...(alsoOn.length === 0 ? {} : { alsoOn }) };
  }
  const tot = resolveTot(context);
  if (tot.kind === "unavailable") return tot;
  return command.kind === "new" ? { kind: "new", tot: tot.tot } : { kind: "stop", tot: tot.tot };
};
