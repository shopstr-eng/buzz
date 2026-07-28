import { createFileRoute } from "@tanstack/react-router";
import { HomeView } from "@/features/home/ui/HomeView";

export const Route = createFileRoute("/channels/home")({
  component: HomeView,
});
