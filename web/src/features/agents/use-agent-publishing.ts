/**
 * Publishing hook for the agent directory: create/edit/delete personas
 * (30175), teams (30176) and managed agent records (30177) from the web.
 * Events are owner-signed and relay-published; the directory subscription in
 * use-agents.ts picks the echoes up automatically.
 */

import { useCallback, useState } from "react";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";
import { useRelay } from "@/shared/context/relay-context";
import { getSignFn } from "@/shared/lib/identity";
import type { UnsignedNostrEvent } from "@/shared/lib/nostr-signer";
import { KIND_PERSONA, KIND_TEAM, KIND_MANAGED_AGENT } from "./use-agents";
import {
  buildPersonaEvent,
  buildTeamEvent,
  buildManagedAgentEvent,
  buildDirectoryDeleteEvent,
  slugifyPersonaName,
  ensureUniqueSlug,
  type PersonaFormInput,
  type TeamFormInput,
  type ManagedAgentFormInput,
} from "./agent-events";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function useAgentPublishing(): {
  savePersona: (input: PersonaFormInput, existingId: string | null, takenSlugs: string[]) => Promise<string>;
  deletePersona: (id: string) => Promise<void>;
  saveTeam: (input: TeamFormInput, existingId: string | null) => Promise<string>;
  deleteTeam: (id: string) => Promise<void>;
  createManagedAgent: (input: ManagedAgentFormInput) => Promise<{ pubkey: string; nsec: string }>;
  updateManagedAgent: (input: ManagedAgentFormInput, agentPubkey: string) => Promise<void>;
  deleteManagedAgent: (id: string) => Promise<void>;
  isPublishing: boolean;
  error: string | null;
} {
  const { connection, identity } = useRelay();
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishTemplate = useCallback(
    async (template: UnsignedNostrEvent): Promise<void> => {
      if (!connection) throw new Error("Not connected to the relay.");
      const signFn = getSignFn();
      if (!signFn) throw new Error("No signing key available. Please log in again.");
      const signed = await signFn(template);
      await connection.publishAndWait(signed);
    },
    [connection],
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      setIsPublishing(true);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Publish failed.");
        throw e;
      } finally {
        setIsPublishing(false);
      }
    },
    [],
  );

  const requireOwner = useCallback((): string => {
    if (!identity?.pubkey) throw new Error("You must be logged in to manage agents.");
    return identity.pubkey;
  }, [identity]);

  const savePersona = useCallback(
    (input: PersonaFormInput, existingId: string | null, takenSlugs: string[]) =>
      run(async () => {
        requireOwner();
        const slug = existingId ?? ensureUniqueSlug(slugifyPersonaName(input.displayName), takenSlugs);
        await publishTemplate(buildPersonaEvent(input, slug, nowSec()));
        return slug;
      }),
    [run, publishTemplate, requireOwner],
  );

  const deletePersona = useCallback(
    (id: string) =>
      run(async () => {
        const owner = requireOwner();
        await publishTemplate(buildDirectoryDeleteEvent(KIND_PERSONA, owner, id, nowSec()));
      }),
    [run, publishTemplate, requireOwner],
  );

  const saveTeam = useCallback(
    (input: TeamFormInput, existingId: string | null) =>
      run(async () => {
        requireOwner();
        const teamId = existingId ?? crypto.randomUUID();
        await publishTemplate(buildTeamEvent(input, teamId, nowSec()));
        return teamId;
      }),
    [run, publishTemplate, requireOwner],
  );

  const deleteTeam = useCallback(
    (id: string) =>
      run(async () => {
        const owner = requireOwner();
        await publishTemplate(buildDirectoryDeleteEvent(KIND_TEAM, owner, id, nowSec()));
      }),
    [run, publishTemplate, requireOwner],
  );

  const createManagedAgent = useCallback(
    (input: ManagedAgentFormInput) =>
      run(async () => {
        requireOwner();
        const secretKey = generateSecretKey();
        const pubkey = getPublicKey(secretKey);
        await publishTemplate(buildManagedAgentEvent(input, pubkey, nowSec()));
        // Returned for one-time display — the web never stores agent secrets.
        return { pubkey, nsec: nip19.nsecEncode(secretKey) };
      }),
    [run, publishTemplate, requireOwner],
  );

  const updateManagedAgent = useCallback(
    (input: ManagedAgentFormInput, agentPubkey: string) =>
      run(async () => {
        requireOwner();
        // Replace-on-save: republish the FULL record under the existing d-tag
        // (the agent's pubkey) — no new keypair is generated on edit.
        await publishTemplate(buildManagedAgentEvent(input, agentPubkey, nowSec()));
      }),
    [run, publishTemplate, requireOwner],
  );

  const deleteManagedAgent = useCallback(
    (id: string) =>
      run(async () => {
        const owner = requireOwner();
        await publishTemplate(buildDirectoryDeleteEvent(KIND_MANAGED_AGENT, owner, id, nowSec()));
      }),
    [run, publishTemplate, requireOwner],
  );

  return {
    savePersona,
    deletePersona,
    saveTeam,
    deleteTeam,
    createManagedAgent,
    updateManagedAgent,
    deleteManagedAgent,
    isPublishing,
    error,
  };
}
