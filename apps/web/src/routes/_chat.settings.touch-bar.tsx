import { createFileRoute } from "@tanstack/react-router";

import { TouchBarSettings } from "../components/settings/TouchBarSettings";

function SettingsTouchBarRoute() {
  return <TouchBarSettings />;
}

export const Route = createFileRoute("/_chat/settings/touch-bar")({
  component: SettingsTouchBarRoute,
});
