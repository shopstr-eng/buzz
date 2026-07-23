import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadIdentity } from "@/shared/lib/identity";
import { AppLayout } from "@/features/channels/ui/AppLayout";

export const Route = createFileRoute("/repos")({
  beforeLoad: () => {
    if (!loadIdentity()) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});
