import type { ExecutionEnvironmentBuild } from "@t3tools/contracts";
import { normalizeBuildCommit } from "@t3tools/shared/buildIdentity";

import packageJson from "../package.json" with { type: "json" };

// The build config adds these to the manifest it compiles into the server; a source checkout has neither.
const metadata = packageJson as typeof packageJson & {
  readonly t3codeCommitHash?: unknown;
  readonly t3codeBuildTime?: unknown;
};

const commit = normalizeBuildCommit(
  typeof metadata.t3codeCommitHash === "string"
    ? metadata.t3codeCommitHash
    : (process.env.T3CODE_COMMIT_HASH ?? undefined),
);
const builtAtValue = (
  typeof metadata.t3codeBuildTime === "string"
    ? metadata.t3codeBuildTime
    : (process.env.T3CODE_BUILD_TIME ?? "")
).trim();
const builtAt = builtAtValue === "" ? undefined : builtAtValue;

export const SERVER_BUILD: ExecutionEnvironmentBuild = {
  ...(commit === undefined ? {} : { commit }),
  ...(builtAt === undefined ? {} : { builtAt }),
};
