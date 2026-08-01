import type { AgentTeam } from "@/shared/api/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Button } from "@/shared/ui/button";
import { useTeamCatalogShared } from "@/features/agents/lib/useTeamCatalogShared";

type TeamDeleteDialogProps = {
  open: boolean;
  team: AgentTeam | null;
  onConfirm: (team: AgentTeam) => void;
  onOpenChange: (open: boolean) => void;
};

export function TeamDeleteDialog({
  open,
  team,
  onConfirm,
  onOpenChange,
}: TeamDeleteDialogProps) {
  // Only shared teams have a live community-catalog listing to retract; the
  // deletion itself always publishes the catalog retraction regardless.
  const catalogShared = useTeamCatalogShared(team?.id ?? null);
  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete team?</AlertDialogTitle>
          <AlertDialogDescription>
            {team
              ? `Delete "${team.name}". Already-deployed agents are not affected, but this team template will no longer be available.${
                  catalogShared
                    ? " This team is shared, so its listing will also be removed from the community catalog."
                    : ""
                }`
              : "Delete this team."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              onClick={() => {
                if (team) {
                  onConfirm(team);
                }
              }}
              type="button"
              variant="destructive"
            >
              Delete
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
