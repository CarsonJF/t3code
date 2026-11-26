import type {
  EnvironmentId,
  NeedsYouEnvironment,
  NeedsYouInbox,
  NeedsYouItem,
  OrchestrationV2UserInputQuestion,
  TotId,
} from "@t3tools/contracts";

/** An inbox as one connected environment sent it. */
export interface NeedsYouSource {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly inbox: NeedsYouInbox;
}

export interface NeedsYouSection {
  readonly totId: TotId | null;
  readonly totName: string | null;
  /** Set for an External Companion's own section; `totName` then holds its name. */
  readonly companionId: string | null;
  readonly items: ReadonlyArray<NeedsYouItem>;
}

export interface NeedsYouMachine {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly error: string | null;
  /** The connected environment that listed it, which hides, suggests and relays for it. */
  readonly via: EnvironmentId;
  /** Whether this client is connected to it, so answers go through its own thread commands. */
  readonly connected: boolean;
  readonly sections: ReadonlyArray<NeedsYouSection>;
  readonly hidden: ReadonlyArray<NeedsYouItem>;
}

export interface MergedNeedsYou {
  readonly machines: ReadonlyArray<NeedsYouMachine>;
  readonly count: number;
}

const sectionsOf = (
  environment: NeedsYouEnvironment,
  items: ReadonlyArray<NeedsYouItem>,
): ReadonlyArray<NeedsYouSection> => {
  const byTot = new Map<TotId | null, NeedsYouItem[]>();
  const byCompanion = new Map<string, NeedsYouItem[]>();
  for (const item of items) {
    if (item.companion !== undefined) {
      const list = byCompanion.get(item.companion.companionId) ?? [];
      list.push(item);
      byCompanion.set(item.companion.companionId, list);
      continue;
    }
    const list = byTot.get(item.totId) ?? [];
    list.push(item);
    byTot.set(item.totId, list);
  }
  const name = (totId: TotId | null) =>
    totId === null ? null : (environment.tots.find((tot) => tot.id === totId)?.name ?? totId);
  return [
    ...[...byTot.entries()].map(([totId, sectionItems]) => ({
      totId,
      totName: name(totId),
      companionId: null,
      items: sectionItems,
    })),
    ...[...byCompanion.entries()].map(([companionId, sectionItems]) => ({
      totId: null,
      totName: sectionItems[0]?.companion?.name ?? companionId,
      companionId,
      items: sectionItems,
    })),
  ].sort((left, right) =>
    left.totName === null
      ? 1
      : right.totName === null
        ? -1
        : left.totName.localeCompare(right.totName),
  );
};

/**
 * One inbox from every connected environment's. A connected environment speaks for itself,
 * so its items as a linked environment saw them are dropped; dismissals live where it lists.
 */
export function mergeNeedsYou(
  sources: ReadonlyArray<NeedsYouSource>,
  connected: ReadonlySet<EnvironmentId>,
): MergedNeedsYou {
  const chosen = new Map<EnvironmentId, { entry: NeedsYouEnvironment; via: EnvironmentId }>();
  for (const { sourceEnvironmentId, inbox } of sources) {
    for (const entry of inbox.environments) {
      const own = entry.environmentId === sourceEnvironmentId;
      if (!own && connected.has(entry.environmentId)) continue;
      const previous = chosen.get(entry.environmentId);
      if (previous !== undefined && (previous.entry.error === null || entry.error !== null)) {
        continue;
      }
      chosen.set(entry.environmentId, { entry, via: sourceEnvironmentId });
    }
  }
  const machines = [...chosen.values()]
    .map(({ entry, via }): NeedsYouMachine => {
      const visible = entry.items.filter((item) => item.hiddenUntil === undefined);
      return {
        environmentId: entry.environmentId,
        label: entry.label,
        error: entry.error,
        via,
        connected: connected.has(entry.environmentId),
        sections: sectionsOf(entry, visible),
        hidden: entry.items.filter((item) => item.hiddenUntil !== undefined),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  return {
    machines,
    count: machines.reduce(
      (total, machine) =>
        total + machine.sections.reduce((sum, section) => sum + section.items.length, 0),
      0,
    ),
  };
}

/** The value an option chip answers with, as the thread's own question card sends it. */
export const needsYouOptionValue = (option: OrchestrationV2UserInputQuestion["options"][number]) =>
  option.value ?? option.label;

/** Every question's answer, or null while one is still blank. */
export function needsYouAnswers(
  questions: ReadonlyArray<OrchestrationV2UserInputQuestion>,
  picked: Readonly<Record<string, string>>,
): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const answer = picked[question.id]?.trim() ?? "";
    if (answer === "") {
      if (question.required === false) {
        answers[question.id] = "";
        continue;
      }
      return null;
    }
    answers[question.id] = answer;
  }
  return answers;
}

/** "3m", "2h", "4d": how long something has waited. */
export function needsYouAge(at: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
