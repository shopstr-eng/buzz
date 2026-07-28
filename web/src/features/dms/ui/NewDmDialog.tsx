/**
 * New direct message: enter one or more npub/hex pubkeys, publish kind 41010,
 * then navigate once the relay emits the DM channel discovery (kind:39000).
 */

import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { useChannels } from "../../channels/use-channels";
import { findDmChannel, parsePubkeyInput, useOpenDm } from "../use-open-dm";

interface Props {
  onClose: () => void;
}

const RESOLVE_TIMEOUT_MS = 10_000;

export function NewDmDialog({ onClose }: Props) {
  const { identity } = useRelay();
  const { channels } = useChannels();
  const { openDm, error } = useOpenDm();
  const navigate = useNavigate();
  const [inputs, setInputs] = useState<string[]>([""]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [waitingFor, setWaitingFor] = useState<Set<string> | null>(null);

  // Once the DM channel appears in discovery, jump to it.
  useEffect(() => {
    if (!waitingFor) return;
    const channel = findDmChannel(channels, waitingFor);
    if (channel) {
      onClose();
      void navigate({ to: "/channels/$groupId", params: { groupId: channel.groupId } });
    }
  }, [channels, waitingFor, navigate, onClose]);

  // Give up if the relay never confirms.
  useEffect(() => {
    if (!waitingFor) return;
    const t = setTimeout(() => {
      setWaitingFor(null);
      setOpening(false);
      setLocalError("Timed out waiting for the relay to create the conversation.");
    }, RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [waitingFor]);

  async function handleOpen() {
    const parsed: string[] = [];
    for (const input of inputs) {
      if (!input.trim()) continue;
      const pk = parsePubkeyInput(input);
      if (!pk) {
        setLocalError(`Invalid pubkey: ${input.slice(0, 24)}…`);
        return;
      }
      parsed.push(pk);
    }
    if (parsed.length === 0) {
      setLocalError("Enter at least one pubkey (npub or hex).");
      return;
    }
    if (identity && parsed.every((pk) => pk === identity.pubkey)) {
      setLocalError("You can't DM only yourself.");
      return;
    }

    setLocalError(null);
    setOpening(true);

    // Already have this conversation? Go straight there.
    const fullSet = new Set([...(identity ? [identity.pubkey] : []), ...parsed]);
    const existing = findDmChannel(channels, fullSet);
    if (existing) {
      onClose();
      void navigate({ to: "/channels/$groupId", params: { groupId: existing.groupId } });
      return;
    }

    const published = await openDm(parsed);
    if (!published) {
      // Publish/signing failed — the error is already surfaced; don't wait
      // for a channel that will never arrive.
      setOpening(false);
      return;
    }
    setWaitingFor(fullSet);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={onClose}>
      <div
        className="w-96 rounded-xl border border-black/10 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-[#1E1E1E]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-black dark:text-white">New message</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-2 text-xs text-black/50 dark:text-white/50">
          Recipient pubkey{inputs.length > 1 ? "s" : ""} (npub or hex):
        </p>
        <div className="space-y-1.5">
          {inputs.map((value, i) => (
            <input
              key={i}
              type="text"
              value={value}
              onChange={(e) =>
                setInputs(inputs.map((v, j) => (j === i ? e.target.value : v)))
              }
              onKeyDown={(e) => { if (e.key === "Enter") void handleOpen(); }}
              placeholder="npub1… or 64-char hex"
              autoFocus={i === 0}
              className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 font-mono text-xs text-black placeholder:font-sans placeholder:text-black/35 focus:border-black/30 focus:outline-none dark:border-white/15 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30"
            />
          ))}
        </div>
        {inputs.length < 8 && (
          <button
            type="button"
            onClick={() => setInputs([...inputs, ""])}
            className="mt-1.5 flex items-center gap-1 text-xs text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
          >
            <Plus className="h-3 w-3" /> Add participant
          </button>
        )}

        {(localError ?? error) && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{localError ?? error}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleOpen()}
            disabled={opening}
            className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white hover:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {opening ? "Opening…" : "Open conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}
