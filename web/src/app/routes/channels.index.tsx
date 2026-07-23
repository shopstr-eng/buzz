import { createFileRoute } from "@tanstack/react-router";
import { ChannelEmptyState } from "@/features/channels/ui/ChannelEmptyState";

export const Route = createFileRoute("/channels/")({
  component: ChannelEmptyState,
});
