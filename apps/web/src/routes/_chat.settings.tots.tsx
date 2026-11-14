import { createFileRoute } from "@tanstack/react-router";

import { TotsSettings } from "../components/settings/TotsSettings";

export const Route = createFileRoute("/_chat/settings/tots")({
  component: TotsSettings,
});
