import { createFileRoute } from "@tanstack/react-router";
import { AgentsView } from "@/features/agents/ui/AgentsView";

export const Route = createFileRoute("/channels/agents")({
  component: AgentsView,
});
