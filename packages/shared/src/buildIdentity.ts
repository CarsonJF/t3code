import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { compareSemverVersions } from "./semver.ts";

/** What a build can tell us about itself and what a release offers. Dates are ISO strings. */
export interface BuildIdentity {
  readonly version: string;
  /** Commit the build came from, short or full. */
  readonly commit?: string | undefined;
  /** When this build was produced. */
  readonly builtAt?: string | undefined;
  /** When the release's assets were last published. */
  readonly publishedAt?: string | undefined;
  /** Release asset digest, when the release publishes one. */
  readonly digest?: string | undefined;
}

export type BuildIdentityVerdict = "same-build" | "different-build" | "newer-version" | "downgrade";

export interface BuildIdentityComparison {
  readonly verdict: BuildIdentityVerdict;
  /** Whether a client should offer to install the available build. */
  readonly offer: boolean;
  /** A same-version rebuild, which only the force path can install. */
  readonly force: boolean;
  readonly reason: string;
}

const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Git accepts short and full hashes; treat either spelling of the same commit as equal. */
export function normalizeBuildCommit(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed !== undefined && COMMIT_PATTERN.test(trimmed) ? trimmed : undefined;
}

function commitsMatch(left: string, right: string): boolean {
  return left.startsWith(right) || right.startsWith(left);
}

function timestamp(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Option.match(DateTime.make(value), {
    onNone: () => undefined,
    onSome: (dateTime) => DateTime.toEpochMillis(dateTime),
  });
}

const shorterCommit = (commit: string): string => commit.slice(0, 12);

function sameVersionComparison(
  current: BuildIdentity,
  available: BuildIdentity,
): BuildIdentityComparison {
  const currentCommit = normalizeBuildCommit(current.commit);
  const availableCommit = normalizeBuildCommit(available.commit);
  if (currentCommit !== undefined && availableCommit !== undefined) {
    if (commitsMatch(currentCommit, availableCommit)) {
      return {
        verdict: "same-build",
        offer: false,
        force: false,
        reason: `Already on build ${shorterCommit(currentCommit)}.`,
      };
    }
    return {
      verdict: "different-build",
      offer: true,
      force: true,
      reason: `Same version, newer build ${shorterCommit(availableCommit)}.`,
    };
  }

  const availablePublishedAt = timestamp(available.publishedAt);
  const currentBuiltAt = timestamp(current.builtAt);
  if (availablePublishedAt !== undefined && currentBuiltAt !== undefined) {
    return availablePublishedAt > currentBuiltAt
      ? {
          verdict: "different-build",
          offer: true,
          force: true,
          reason: "The release was published after this build was produced.",
        }
      : {
          verdict: "same-build",
          offer: false,
          force: false,
          reason: "This build is at least as new as the published release.",
        };
  }

  if (availableCommit !== undefined || available.publishedAt !== undefined) {
    return {
      verdict: "different-build",
      offer: true,
      force: true,
      reason: "This build does not record its commit, so the release may be a rebuild.",
    };
  }

  return {
    verdict: "same-build",
    offer: false,
    force: false,
    reason: "No build identity is available to compare.",
  };
}

/**
 * Compare the running build with the release for the same version. A newer or older version keeps
 * the ordinary version rules; only an equal version falls back to the commit and publish time.
 */
export function compareBuildIdentities(
  current: BuildIdentity,
  available: BuildIdentity,
  options: { readonly allowDowngrade?: boolean } = {},
): BuildIdentityComparison {
  const versionOrder = compareSemverVersions(available.version, current.version);
  if (versionOrder > 0) {
    return {
      verdict: "newer-version",
      offer: true,
      force: false,
      reason: `T3 Code ${available.version} is available.`,
    };
  }
  if (versionOrder < 0) {
    return {
      verdict: "downgrade",
      offer: options.allowDowngrade === true,
      force: false,
      reason:
        options.allowDowngrade === true
          ? `Installs the older build ${available.version}.`
          : `${available.version} is older than the installed ${current.version}.`,
    };
  }
  return sameVersionComparison(current, available);
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatBuildDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Option.match(DateTime.make(value), {
    onNone: () => undefined,
    onSome: (dateTime) => DateTime.formatIntl(dateTime, DATE_FORMAT),
  });
}

/** "Build abc1234def56, built Nov 14, 2026", or as much of that as the build records. */
export function describeBuildIdentity(identity: BuildIdentity): string {
  const commit = normalizeBuildCommit(identity.commit);
  const built = formatBuildDate(identity.builtAt);
  const published = formatBuildDate(identity.publishedAt);
  if (commit === undefined) {
    if (published !== undefined) return `Published ${published}`;
    if (built !== undefined) return `Built ${built}`;
    return "Build unknown";
  }
  const label = `Build ${shorterCommit(commit)}`;
  if (built !== undefined) return `${label}, built ${built}`;
  if (published !== undefined) return `${label}, published ${published}`;
  return label;
}
