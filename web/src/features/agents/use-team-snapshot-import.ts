/**
 * One-click "Add team" import from a chat attachment: validate the fetched
 * .team.json text against the desktop team-snapshot contract, publish each
 * member as a NEW persona (fresh slug), then mint a NEW team (fresh id)
 * grouping them. Imports never overwrite existing personas or teams,
 * matching the desktop always-mint rule and the agent-snapshot import.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAgentDirectory } from "./use-agents";
import { useAgentPublishing } from "./use-agent-publishing";
import { snapshotToPersonaInput } from "./lib/agent-snapshot";
import { parseTeamSnapshot } from "./lib/team-snapshot";

export function useTeamSnapshotImport(): {
  /** Import team snapshot JSON text; resolves with the new team's name. */
  importTeamSnapshot: (jsonText: string) => Promise<string>;
} {
  const { personas } = useAgentDirectory();
  const { savePersona, saveTeam } = useAgentPublishing();

  // Ref so importTeamSnapshot stays stable while the directory streams in.
  const personasRef = useRef(personas);
  useEffect(() => {
    personasRef.current = personas;
  }, [personas]);

  const importTeamSnapshot = useCallback(
    async (jsonText: string): Promise<string> => {
      const parsed = parseTeamSnapshot(jsonText);
      if (!parsed.ok) throw new Error(parsed.error);
      const { team, members } = parsed.snapshot;

      // Mint each member with a fresh slug; feed minted slugs back into the
      // taken list so two same-named members in one snapshot never collide.
      const takenSlugs = personasRef.current.map((p) => p.id);
      const personaIds: string[] = [];
      for (const member of members) {
        const input = snapshotToPersonaInput(member);
        const slug = await savePersona(input, null, takenSlugs);
        takenSlugs.push(slug);
        personaIds.push(slug);
      }

      await saveTeam(
        {
          name: team.name.trim(),
          description: team.description?.trim() || undefined,
          instructions: team.instructions?.trim() || undefined,
          personaIds,
        },
        null, // fresh team id — never overwrite an existing team
      );
      return team.name.trim();
    },
    [savePersona, saveTeam],
  );

  return { importTeamSnapshot };
}
