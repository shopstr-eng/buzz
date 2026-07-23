import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "@/features/auth/ui/LoginPage";
import { loadIdentity } from "@/shared/lib/identity";

export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    // Already logged in — send straight to channels.
    if (loadIdentity()) {
      throw redirect({ to: "/channels" });
    }
  },
  component: LoginPage,
});
