/**
 * Admin panel — Agents page.
 *
 * Lists every pubkey that has published a kind:10100 (Agent Profile) event,
 * shows their channel_add_policy and which channels they're in, and lets
 * admins add an agent to a channel via kind:9000 (Add Member).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminRelayWs, relayWsUrlFromOrigin } from "./relay-ws";
import type { NostrEvent } from "./relay-ws";

const KIND_GROUP_METADATA = 39000;
const KIND_GROUP_MEMBERS = 39002;
const KIND_AGENT_PROFILE = 10100;
const KIND_ADD_MEMBER = 9000;

type AddPolicy = "anyone" | "owner_only" | "nobody" | "unknown";

interface AgentRecord {
  pubkey: string;
  addPolicy: AddPolicy;
  /** groupIds this agent belongs to */
  channelIds: Set<string>;
}

interface ChannelRecord {
  groupId: string;
  name: string;
}

function short(pubkey: string) {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
}

function policyLabel(p: AddPolicy) {
  if (p === "anyone") return { text: "Anyone", cls: "ag-badge-green" };
  if (p === "owner_only") return { text: "Owner only", cls: "ag-badge-amber" };
  if (p === "nobody") return { text: "Nobody", cls: "ag-badge-red" };
  return { text: "Unknown", cls: "ag-badge-neutral" };
}

type ModalProps = {
  agent: AgentRecord;
  channels: ChannelRecord[];
  onAdd: (agentPubkey: string, channelId: string) => Promise<void>;
  onClose: () => void;
};

function AddToChannelModal({ agent, channels, onAdd, onClose }: ModalProps) {
  const [selectedChannel, setSelectedChannel] = useState(channels[0]?.groupId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const eligible = channels.filter((ch) => !agent.channelIds.has(ch.groupId));

  async function handleAdd() {
    if (!selectedChannel) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAdd(agent.pubkey, selectedChannel);
      setDone(true);
      setTimeout(onClose, 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="ch-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ch-modal" role="dialog" aria-modal="true">
        <div className="ch-modal-header">
          <h2 className="ch-modal-title">Add agent to channel</h2>
          <button type="button" className="ch-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ch-form">
          <p className="ag-agent-hint">
            Agent: <code title={agent.pubkey}>{short(agent.pubkey)}</code>
          </p>

          {eligible.length === 0 ? (
            <p className="ag-agent-hint" style={{ color: "rgba(0,0,0,.5)" }}>
              This agent is already in every channel.
            </p>
          ) : (
            <>
              <div className="ch-field">
                <label className="ch-label" htmlFor="ag-channel-select">Channel</label>
                <select
                  id="ag-channel-select"
                  className="ch-select"
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value)}
                  disabled={submitting || done}
                >
                  {eligible.map((ch) => (
                    <option key={ch.groupId} value={ch.groupId}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              </div>
              {error && <p className="ch-error" role="alert">{error}</p>}
              {done && <p className="ag-success">✓ Agent added to channel.</p>}
              <div className="ch-form-actions">
                <button
                  type="button"
                  className="ch-btn-secondary"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="ch-btn-primary"
                  onClick={handleAdd}
                  disabled={submitting || done || !selectedChannel}
                >
                  {submitting ? "Adding…" : "Add to channel"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Agents() {
  const [agents, setAgents] = useState<Map<string, AgentRecord>>(new Map());
  const [channels, setChannels] = useState<Map<string, ChannelRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [wsError, setWsError] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<AgentRecord | null>(null);

  const wsRef = useRef<AdminRelayWs | null>(null);
  const agentsRef = useRef<Map<string, AgentRecord>>(new Map());
  const channelsRef = useRef<Map<string, ChannelRecord>>(new Map());
  const eoseCountRef = useRef(0);
  const EXPECTED_EOSE = 3; // metadata + members + agent-profiles

  function tryFinishLoading() {
    eoseCountRef.current += 1;
    if (eoseCountRef.current >= EXPECTED_EOSE) setLoading(false);
  }

  const handleMetadata = useCallback((ev: NostrEvent) => {
    const tags = ev.tags as string[][];
    const groupId = tags.find((t) => t[0] === "d")?.[1];
    if (!groupId) return;
    const name = tags.find((t) => t[0] === "name")?.[1] ?? groupId;
    if (tags.some((t) => t[0] === "hidden")) return;
    channelsRef.current.set(groupId, { groupId, name });
    setChannels(new Map(channelsRef.current));
  }, []);

  const handleMembers = useCallback((ev: NostrEvent) => {
    const tags = ev.tags as string[][];
    const groupId = tags.find((t) => t[0] === "d")?.[1];
    if (!groupId) return;
    const pubkeys = tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
    for (const pubkey of pubkeys) {
      const existing = agentsRef.current.get(pubkey);
      if (existing) {
        existing.channelIds.add(groupId);
        agentsRef.current.set(pubkey, { ...existing });
      }
    }
    setAgents(new Map(agentsRef.current));
  }, []);

  const handleAgentProfile = useCallback((ev: NostrEvent) => {
    const pubkey = ev.pubkey as string;
    let addPolicy: AddPolicy = "unknown";
    try {
      const parsed = JSON.parse(ev.content as string) as Record<string, unknown>;
      if (
        parsed.channel_add_policy === "anyone" ||
        parsed.channel_add_policy === "owner_only" ||
        parsed.channel_add_policy === "nobody"
      ) {
        addPolicy = parsed.channel_add_policy as AddPolicy;
      }
    } catch { /* invalid JSON → leave as "unknown" */ }

    const existing = agentsRef.current.get(pubkey);
    agentsRef.current.set(pubkey, {
      pubkey,
      addPolicy,
      channelIds: existing?.channelIds ?? new Set(),
    });
    setAgents(new Map(agentsRef.current));
  }, []);

  useEffect(() => {
    agentsRef.current = new Map();
    channelsRef.current = new Map();
    eoseCountRef.current = 0;

    const ws = new AdminRelayWs(
      relayWsUrlFromOrigin(),
      () => setWsError(null),
      (msg) => setWsError(msg),
    );
    wsRef.current = ws;

    // 1. Fetch all channel metadata (for names)
    const unsubMeta = ws.subscribe(
      { kinds: [KIND_GROUP_METADATA], limit: 500 },
      handleMetadata,
      tryFinishLoading,
    );

    // 2. Fetch all channel member lists (to find which channels each agent is in)
    const unsubMembers = ws.subscribe(
      { kinds: [KIND_GROUP_MEMBERS], limit: 2000 },
      handleMembers,
      tryFinishLoading,
    );

    // 3. Fetch all agent profiles (kind:10100) — these identify who is an agent
    const unsubAgents = ws.subscribe(
      { kinds: [KIND_AGENT_PROFILE], limit: 500 },
      handleAgentProfile,
      tryFinishLoading,
    );

    return () => {
      unsubMeta();
      unsubMembers();
      unsubAgents();
      ws.close();
      wsRef.current = null;
    };
  }, [handleMetadata, handleMembers, handleAgentProfile]);

  async function addToChannel(agentPubkey: string, channelId: string) {
    const ws = wsRef.current;
    if (!ws) throw new Error("Not connected to relay.");
    await ws.publish({
      kind: KIND_ADD_MEMBER,
      tags: [["h", channelId], ["p", agentPubkey], ["role", "member"]],
      content: "",
    });
    // Optimistically update local state
    const agent = agentsRef.current.get(agentPubkey);
    if (agent) {
      agent.channelIds.add(channelId);
      agentsRef.current.set(agentPubkey, { ...agent });
      setAgents(new Map(agentsRef.current));
    }
  }

  const agentList = Array.from(agents.values()).sort((a, b) =>
    a.pubkey.localeCompare(b.pubkey),
  );
  const channelList = Array.from(channels.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return (
    <div className="page">
      <header className="page-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p className="page-eyebrow">Workspace</p>
          <h1>Agents</h1>
          <span>
            AI agents connected to this relay via kind:10100. Agents authenticate
            through their owner's relay membership using NIP-OA.
          </span>
        </div>
      </header>

      {wsError && (
        <div className="state error" role="alert">
          <h2>Could not connect to relay</h2>
          <p>{wsError}</p>
          <button type="button" onClick={() => location.reload()}>Retry</button>
        </div>
      )}

      {!wsError && loading && (
        <div className="state">Loading agents…</div>
      )}

      {!wsError && !loading && agentList.length === 0 && (
        <div className="state">
          <p>No agents found.</p>
          <p style={{ fontSize: ".85rem", color: "rgba(0,0,0,.5)", marginTop: ".5rem" }}>
            Agents appear here once they publish a kind:10100 profile event to the relay.
          </p>
        </div>
      )}

      {!wsError && !loading && agentList.length > 0 && (
        <div className="ag-table-wrap">
          <table className="ag-table">
            <thead>
              <tr>
                <th>Agent pubkey</th>
                <th>Add policy</th>
                <th>Channels</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {agentList.map((agent) => {
                const { text, cls } = policyLabel(agent.addPolicy);
                const agentChannels = Array.from(agent.channelIds)
                  .map((id) => channels.get(id))
                  .filter(Boolean) as ChannelRecord[];

                return (
                  <tr key={agent.pubkey}>
                    <td>
                      <code className="ag-pubkey" title={agent.pubkey}>
                        {short(agent.pubkey)}
                      </code>
                    </td>
                    <td>
                      <span className={`badge ${cls}`}>{text}</span>
                    </td>
                    <td className="ag-channels">
                      {agentChannels.length === 0 ? (
                        <span className="ag-empty">No channels</span>
                      ) : (
                        agentChannels.map((ch) => (
                          <span key={ch.groupId} className="ag-channel-tag">
                            {ch.name}
                          </span>
                        ))
                      )}
                    </td>
                    <td className="ag-actions">
                      <button
                        type="button"
                        className="ch-btn-secondary ag-add-btn"
                        onClick={() => setAddTarget(agent)}
                        title="Add to channel"
                      >
                        + Add to channel
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {addTarget && (
        <AddToChannelModal
          agent={addTarget}
          channels={channelList}
          onAdd={addToChannel}
          onClose={() => setAddTarget(null)}
        />
      )}
    </div>
  );
}
