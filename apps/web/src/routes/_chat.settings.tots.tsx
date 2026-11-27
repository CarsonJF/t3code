import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId, TotId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isTotId = Schema.is(TotId);

import { TotsSettings } from "../components/settings/TotsSettings";

function SettingsTotsRoute() {
  const target = Route.useSearch();
  return <TotsSettings {...target} />;
}

export const Route = createFileRoute("/_chat/settings/tots")({
  // One Tot's full settings open on this page, the way Providers opens one instance.
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(isTotId(raw.tot) ? { tot: raw.tot } : {}),
  }),
  component: SettingsTotsRoute,
});
