import type { ServerSelfUpdateCapability } from "@t3tools/contracts";
import {
  type BuildIdentity,
  type BuildIdentityComparison,
  compareBuildIdentities,
} from "@t3tools/shared/buildIdentity";
import {
  cliReleaseApiUrl,
  cliReleaseCommitApiUrl,
  cliReleaseIndexPageUrl,
  cliReleasePageUrl,
  type CliReleaseChannel,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";

/** A release as GitHub describes it; the fork publishes `<version>-custom` tags. */
export interface ReleaseBuild extends BuildIdentity {
  readonly releaseUrl: string;
}

interface ReleaseResponse {
  readonly published_at?: unknown;
  readonly assets?: unknown;
}

interface CommitResponse {
  readonly sha?: unknown;
}

const RELEASE_ACCEPT = "application/vnd.github+json";

function commitOf(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : undefined;
}

function digestOf(assets: unknown, fileName: string | undefined): string | undefined {
  if (!Array.isArray(assets) || fileName === undefined) return undefined;
  for (const asset of assets) {
    if (typeof asset !== "object" || asset === null) continue;
    const record = asset as { name?: unknown; digest?: unknown };
    if (record.name === fileName && typeof record.digest === "string" && record.digest !== "") {
      return record.digest;
    }
  }
  return undefined;
}

/**
 * Read the fork's release for a version and its build commit. A failed commit lookup still returns
 * the publish time, which older builds can compare against.
 */
export async function fetchReleaseBuild(
  version: string,
  options: {
    readonly fetchImpl?: typeof fetch;
    readonly platformKey?: string | undefined;
    readonly signal?: AbortSignal;
  } = {},
): Promise<ReleaseBuild> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { Accept: RELEASE_ACCEPT };
  const response = await fetchImpl(cliReleaseApiUrl(version), {
    headers,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    throw new Error(`Could not read release ${version} (${response.status}).`);
  }
  const release = (await response.json()) as ReleaseResponse;
  const publishedAt =
    typeof release.published_at === "string" && !Number.isNaN(Date.parse(release.published_at))
      ? release.published_at
      : undefined;
  const fileName =
    options.platformKey === undefined
      ? undefined
      : `t3-${version}-${options.platformKey}.${options.platformKey.startsWith("win32") ? "zip" : "tar.gz"}`;
  const digest = digestOf(release.assets, fileName);

  let commit: string | undefined;
  try {
    const commitResponse = await fetchImpl(cliReleaseCommitApiUrl(version), {
      headers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (commitResponse.ok) {
      commit = commitOf(((await commitResponse.json()) as CommitResponse).sha);
    }
  } catch {
    // The publish time is enough to offer a rebuild; the commit is the stronger check.
  }

  return {
    version,
    ...(commit === undefined ? {} : { commit }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(digest === undefined ? {} : { digest }),
    releaseUrl: cliReleasePageUrl(version),
  };
}

const RELEASE_INDEX_MAX_PAGES = 3;

/** The newest published release on a channel, read through GitHub's API. */
export async function fetchLatestReleaseVersion(
  channel: CliReleaseChannel,
  options: { readonly fetchImpl?: typeof fetch; readonly signal?: AbortSignal } = {},
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  for (let page = 1; page <= RELEASE_INDEX_MAX_PAGES; page += 1) {
    const response = await fetchImpl(cliReleaseIndexPageUrl(page), {
      headers: { Accept: RELEASE_ACCEPT },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!response.ok) {
      throw new Error(`Could not list releases (${response.status}).`);
    }
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("The release list had an unexpected shape.");
    }
    const releases = payload.flatMap((entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { tag_name?: unknown }).tag_name === "string"
        ? [
            {
              tag_name: (entry as { tag_name: string }).tag_name,
              draft: (entry as { draft?: unknown }).draft === true,
            },
          ]
        : [],
    );
    const version = newestCliReleaseVersion(releases, channel);
    if (version !== undefined) return version;
    if (releases.length < 100) break;
  }
  throw new Error(`No published ${channel} release was found.`);
}

/** The newest release on the running build's channel, with its build identity. */
export async function fetchLatestReleaseBuild(options: {
  readonly channel: CliReleaseChannel;
  readonly fetchImpl?: typeof fetch;
  readonly platformKey?: string | undefined;
  readonly signal?: AbortSignal;
}): Promise<ReleaseBuild> {
  const version = await fetchLatestReleaseVersion(options.channel, options);
  return fetchReleaseBuild(version, options);
}

export interface ForceUpdateEnvironment {
  readonly connected: boolean;
  readonly canMaintain: boolean;
  readonly updating: boolean;
  readonly selfUpdate: ServerSelfUpdateCapability | null;
  readonly desktopAppUpdate: boolean;
}

export interface ForceUpdateSubject {
  readonly kind: "app" | "environment";
  readonly label: string;
  readonly current: BuildIdentity;
  /** Read only for environments. */
  readonly environment?: ForceUpdateEnvironment | undefined;
}

export interface ForceUpdatePlan {
  readonly comparison: BuildIdentityComparison;
  readonly available: ReleaseBuild;
  readonly installable: boolean;
  readonly blockReason: string | null;
  readonly restartNote: string;
  readonly sameVersion: boolean;
}

function environmentBlockReason(
  environment: ForceUpdateEnvironment,
  sameVersion: boolean,
): string | null {
  if (!environment.connected) return "That machine is not connected.";
  if (!environment.canMaintain) return "You do not have permission to update that machine.";
  if (environment.updating) return "That machine is already updating.";
  if (environment.selfUpdate === null) {
    return "That install cannot update itself; update it on its machine.";
  }
  if (sameVersion && environment.selfUpdate === "boot-service") {
    return "The background service cannot reinstall the same version remotely. Install the rebuild on that machine itself.";
  }
  if (environment.selfUpdate === "desktop-managed" && !environment.desktopAppUpdate) {
    return "The desktop app on that machine is too old to reinstall itself.";
  }
  return null;
}

/** Decide whether the release can be installed on the subject, and why not when it cannot. */
export function planForceUpdate(
  subject: ForceUpdateSubject,
  available: ReleaseBuild,
): ForceUpdatePlan {
  const comparison = compareBuildIdentities(subject.current, available);
  const sameVersion = compareSemverVersions(available.version, subject.current.version) === 0;
  if (subject.kind === "app") {
    return {
      comparison,
      available,
      installable: comparison.offer,
      blockReason: comparison.offer ? null : comparison.reason,
      restartNote: "T3 Code closes, installs the build, and reopens.",
      sameVersion,
    };
  }
  const environment = subject.environment;
  if (environment === undefined) {
    return {
      comparison,
      available,
      installable: false,
      blockReason: "That machine cannot update itself.",
      restartNote: "",
      sameVersion,
    };
  }
  const blocked = environmentBlockReason(environment, sameVersion);
  const blockReason = blocked ?? (comparison.offer ? null : comparison.reason);
  return {
    comparison,
    available,
    installable: blockReason === null,
    blockReason,
    restartNote:
      environment.selfUpdate === "desktop-managed"
        ? "The desktop app on that machine closes and reopens with the new build."
        : "The server restarts and reconnects; running threads can resume afterwards.",
    sameVersion,
  };
}
