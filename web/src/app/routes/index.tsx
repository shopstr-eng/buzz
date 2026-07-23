import { createFileRoute, redirect } from "@tanstack/react-router";
import { loadIdentity } from "@/shared/lib/identity";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: loadIdentity() ? "/channels" : "/login" });
  },
  component: () => null,
});
