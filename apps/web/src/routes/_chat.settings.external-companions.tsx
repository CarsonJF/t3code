import { createFileRoute } from "@tanstack/react-router";

import { ExternalCompanionsSettings } from "../components/settings/ExternalCompanionsSettings";

export const Route = createFileRoute("/_chat/settings/external-companions")({
  component: ExternalCompanionsSettings,
});
