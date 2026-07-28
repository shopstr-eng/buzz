import { createFileRoute } from "@tanstack/react-router";
import { SearchView } from "@/features/search/ui/SearchView";

export const Route = createFileRoute("/channels/search")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
  }),
  component: SearchView,
});
