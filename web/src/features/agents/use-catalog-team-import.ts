/**
 * One-click "Add team" import from the community catalog (kind:30178).
 * Mints each embedded member projection as a NEW owner-private persona
 * (fresh slug, shared:false, allowlist downgraded to owner-only), then a
 * NEW team (fresh id) grouping them — the always-mint rule shared with
 * snapshot imports: catalog copies never overwrite existing entries.
 *
 * If any publish fails midway, already-published member personas are rolled
 * back via delete events so no stray members linger; a clean retry then
 * re-mints everything without duplicates. If rollback itself partially
 * fails, the error names the members left behind.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAgentDirectory } from "./use-agents";
import { useAgentPublishing } from "./use-agent-publishing";
import {
  catalogTeamMemberToPersonaInput,
  catalogTeamToTeamInput,
  type CatalogTeam,
} from "./lib/team-catalog";

export function useCatalogTeamImport(): {
  /** Import a catalog team; resolves with the new team's name. */
  importCatalogTeam: (team: CatalogTeam) => Promise<string>;
} {
  const { personas } = useAgentDirectory();
  const { savePersona, saveTeam, deletePersona } = useAgentPublishing();

  // Ref so importCatalogTeam stays stable while the directory streams in.
  const personasRef = useRef(personas);
  useEffect(() => {
    personasRef.current = personas;
  }, [personas]);

  const importCatalogTeam = useCallback(
    async (team: CatalogTeam): Promise<string> => {
      // Mint each member with a fresh slug; feed minted slugs back into the
      // taken list so two same-named members in one team never collide.
      const takenSlugs = personasRef.current.map((p) => p.id);
      const personaIds: string[] = [];
      try {
        for (const member of team.members) {
          const input = catalogTeamMemberToPersonaInput(member);
          const slug = await savePersona(input, null, takenSlugs);
          takenSlugs.push(slug);
          personaIds.push(slug);
        }

        // Fresh team id — never overwrite an existing team.
        await saveTeam(catalogTeamToTeamInput(team, personaIds), null);
      } catch (e) {
        const reason = e instanceof Error ? e.message : "Publish failed.";
        if (personaIds.length === 0) {
          throw new Error(`Team import failed: ${reason}`);
        }
        // Roll back already-published members so a retry starts clean.
        const leftover: string[] = [];
        for (const id of personaIds) {
          try {
            await deletePersona(id);
          } catch {
            leftover.push(id);
          }
        }
        if (leftover.length > 0) {
          throw new Error(
            `Team import failed: ${reason} Cleanup couldn't remove ${leftover.length} already-created member${leftover.length === 1 ? "" : "s"} (${leftover.join(", ")}) — remove them from Agents before retrying.`,
          );
        }
        throw new Error(
          `Team import failed: ${reason} Already-created members were removed, so it's safe to retry.`,
        );
      }
      return team.name;
    },
    [savePersona, saveTeam, deletePersona],
  );

  return { importCatalogTeam };
}
