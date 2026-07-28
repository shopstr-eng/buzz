import { createFileRoute } from "@tanstack/react-router";
import { RemindersView } from "@/features/reminders/ui/RemindersView";

export const Route = createFileRoute("/channels/reminders")({
  component: RemindersView,
});
