import { useAtomValue } from "@effect/atom-react";
import { AuthEnvironmentMaintainScope, managedUpdatesDenial } from "@t3tools/contracts";
import { usePrimaryEnvironment } from "~/state/environments";
import { usePrimaryManagedPolicy } from "~/state/managedPolicy";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentScope } from "~/state/session";
import { resolveServerConfigVersionMismatch } from "~/versionSkew";

import { useServerUpdate, type ServerUpdateTarget } from "../ServerUpdateAction";
import { SettingsRow } from "./settingsLayout";
import { ForceUpdateAction } from "./ForceUpdateAction";
import type { ForceUpdatePlan, ForceUpdateSubject } from "./forceUpdate.logic";

/** The web client's own server is not in the saved-environment list; offer its force update here. */
export function HostedServerUpdateRow() {
  const environment = usePrimaryEnvironment();
  const environmentId = environment?.environmentId ?? null;
  const updateState = useAtomValue(serverEnvironment.updateStateAtom(environmentId));
  const canMaintain = useEnvironmentScope(environmentId, AuthEnvironmentMaintainScope);
  const managedPolicy = usePrimaryManagedPolicy();
  const updateServer = useServerUpdate();

  const config = environment?.serverConfig ?? null;
  if (environment === null || config === null || environment.connection.phase !== "connected") {
    return null;
  }
  const versionMismatch = resolveServerConfigVersionMismatch(config);
  if (
    versionMismatch !== null ||
    updateState.status === "running" ||
    managedUpdatesDenial(managedPolicy) !== undefined
  ) {
    return null;
  }

  const subject: ForceUpdateSubject = {
    kind: "environment",
    label: "this server",
    current: {
      version: config.environment.serverVersion,
      ...(config.environment.build?.commit === undefined
        ? {}
        : { commit: config.environment.build.commit }),
      ...(config.environment.build?.builtAt === undefined
        ? {}
        : { builtAt: config.environment.build.builtAt }),
    },
    environment: {
      connected: true,
      canMaintain,
      updating: false,
      selfUpdate: config.environment.capabilities.serverSelfUpdate ?? null,
      desktopAppUpdate: config.environment.capabilities.desktopAppUpdate === true,
    },
  };

  const install = async (plan: ForceUpdatePlan): Promise<boolean> => {
    const target: ServerUpdateTarget = {
      environmentId: environment.environmentId,
      serverLabel: "this server",
      selfUpdate: subject.environment?.selfUpdate ?? null,
      installation: config.environment.capabilities.serverInstallation,
      desktopAppUpdate: subject.environment?.desktopAppUpdate ?? false,
      targetVersion: plan.available.version,
      force: true,
    };
    return (await updateServer(target)).status === "updated";
  };

  return (
    <SettingsRow
      title="This server"
      description={`Re-check the fork's release and reinstall ${config.environment.serverVersion} even if its version did not change.`}
      control={
        <ForceUpdateAction
          subject={subject}
          size="sm"
          variant="outline"
          onInstall={install}
          disabled={!canMaintain}
        />
      }
    />
  );
}
