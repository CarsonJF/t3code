import { createFileRoute } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";

import { CompanionChatView } from "../components/companions/CompanionChatView";

const CHANNEL = /^(?:main|child:[A-Za-z0-9._:-]{1,128})$/;

export const Route = createFileRoute("/_chat/companions/$environmentId/$companionId")({
  validateSearch: (raw: Record<string, unknown>): { channel?: string } =>
    typeof raw.channel === "string" && CHANNEL.test(raw.channel) ? { channel: raw.channel } : {},
  component: CompanionChatRoute,
});

function CompanionChatRoute() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <CompanionChatView
      environmentId={params.environmentId as EnvironmentId}
      companionId={params.companionId}
      channel={search.channel ?? "main"}
    />
  );
}
