import { createFileRoute } from "@tanstack/react-router";
import { useChannels } from "@/features/channels/use-channels";
import { ChannelView } from "@/features/channels/ui/ChannelView";
import { ChannelEmptyState } from "@/features/channels/ui/ChannelEmptyState";

function ChannelPage() {
  const { groupId } = Route.useParams();
  const { channels } = useChannels();
  const channel = channels.find((c) => c.groupId === groupId);

  if (!channel) {
    // Channel not yet loaded or doesn't exist — show placeholder.
    return <ChannelEmptyState />;
  }

  return <ChannelView channel={channel} />;
}

export const Route = createFileRoute("/channels/$groupId")({
  component: ChannelPage,
});
