import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/features/channels/ui/AppLayout";
import { loadIdentity } from "@/shared/lib/identity";

export const Route = createFileRoute("/channels")({
  beforeLoad: () => {
    // Gate the entire /channels tree behind a valid identity.
    if (!loadIdentity()) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});
