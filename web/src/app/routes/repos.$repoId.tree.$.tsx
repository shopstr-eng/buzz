import { createFileRoute } from "@tanstack/react-router";
import { RepoSubTreePage } from "@/features/repos/ui/RepoSubTreePage";

export const Route = createFileRoute("/repos/$repoId/tree/$")({
  component: RepoSubTreePage,
});
