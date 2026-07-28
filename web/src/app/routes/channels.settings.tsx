import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "@/features/notifications/ui/SettingsView";

export const Route = createFileRoute("/channels/settings")({
  component: SettingsView,
});
