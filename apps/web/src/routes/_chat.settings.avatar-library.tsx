import { createFileRoute } from "@tanstack/react-router";

import { AvatarLibrarySettings } from "../components/settings/AvatarLibrarySettings";

export const Route = createFileRoute("/_chat/settings/avatar-library")({
  component: AvatarLibrarySettings,
});
