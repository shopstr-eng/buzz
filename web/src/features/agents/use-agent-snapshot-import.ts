/**
 * One-click "Add agent" import from a chat attachment: validate the fetched
 * .agent.json text against the desktop snapshot contract and publish it as a
 * NEW persona (fresh slug — imports never overwrite, matching the desktop
 * always-mint rule and AgentsView's file-picker import).
 */

import { useCallback, useEffect, useRef } from "react";
import { useAgentDirectory } from "./use-agents";
import { useAgentPublishing } from "./use-agent-publishing";
import { parseSnapshot, snapshotToPersonaInput } from "./lib/agent-snapshot";

export function useAgentSnapshotImport(): {
  /** Import snapshot JSON text; resolves with the new persona's display name. */
  importSnapshot: (jsonText: string) => Promise<string>;
} {
  const { personas } = useAgentDirectory();
  const { savePersona } = useAgentPublishing();

  // Ref so importSnapshot stays stable while the directory streams in.
  const personasRef = useRef(personas);
  useEffect(() => {
    personasRef.current = personas;
  }, [personas]);

  const importSnapshot = useCallback(
    async (jsonText: string): Promise<string> => {
      const parsed = parseSnapshot(jsonText);
      if (!parsed.ok) throw new Error(parsed.error);
      const input = snapshotToPersonaInput(parsed.snapshot);
      await savePersona(
        input,
        null,
        personasRef.current.map((p) => p.id),
      );
      return input.displayName;
    },
    [savePersona],
  );

  return { importSnapshot };
}
