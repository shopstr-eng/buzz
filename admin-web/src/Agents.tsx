/**
 * Admin panel — Agents page.
 *
 * Lists AI agents visible on this relay:
 *  - Agents identified by kind:10100 (Agent Profile).
 *  - The built-in ACP agent (from relay-info.json) even before it has published
 *    kind:10100.
 *
 * Two-phase loading fixes the channel-scoped kind:39002 issue:
 *  Phase 1 — kind:39000 (channel metadata) + kind:10100 (agent profiles).
 *  Phase 2 — kind:39002 with "#d": [all known groupIds] (after phase 1 EOSE).
 *
 * The admin can:
 *  - Add any agent to a channel.
 *  - Edit the ACP agent's display profile (name / picture / about), which
 *    signs kind:0 + kind:10100 via POST /api/admin/v1/agents/sign-profile.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AdminRelayWs, relayWsUrlFromOrigin } from "./relay-ws";
import type { NostrEvent } from "./relay-ws";
import { post } from "./api";

const KIND_GROUP_METADATA = 39000;
const KIND_GROUP_MEMBERS  = 39002;
const KIND_AGENT_PROFILE  = 10100;
const KIND_ADD_MEMBER     = 9000;

type AddPolicy = "anyone" | "owner_only" | "nobody" | "unknown";

interface AgentRecord {
  pubkey: string;
  addPolicy: AddPolicy;
  channelIds: Set<string>;
  name?: string;
  picture?: string;
}

interface ChannelRecord {
  groupId: string;
  name: string;
}

interface SignProfileResponse {
  pubkey: string;
  kind0: NostrEvent;
  kind10100: NostrEvent;
}

function short(pubkey: string) {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
}

function policyLabel(p: AddPolicy) {
  if (p === "anyone")     return { text: "Anyone",     cls: "ag-badge-green" };
  if (p === "owner_only") return { text: "Owner only", cls: "ag-badge-amber" };
  if (p === "nobody")     return { text: "Nobody",     cls: "ag-badge-red" };
  return { text: "Unknown", cls: "ag-badge-neutral" };
}

// ── Add-to-channel modal ─────────────────────────────────────────────────────

type AddModalProps = {
  agent: AgentRecord;
  channels: ChannelRecord[];
  onAdd: (agentPubkey: string, channelId: string) => Promise<void>;
  onClose: () => void;
};

function AddToChannelModal({ agent, channels, onAdd, onClose }: AddModalProps) {
  const eligible = channels.filter((ch) => !agent.channelIds.has(ch.groupId));
  const [selectedChannel, setSelectedChannel] = useState(eligible[0]?.groupId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
    <div className="ch-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ch-modal" role="dialog" aria-modal="true">
        <div className="ch-modal-header">
          <h2 className="ch-modal-title">Add agent to channel</h2>
          <button type="button" className="ch-modal-close" onClick={onClose} aria-label="Close">×</button>
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
                    <option key={ch.groupId} value={ch.groupId}>{ch.name}</option>
                  ))}
                </select>
              </div>
              {error && <p className="ch-error" role="alert">{error}</p>}
              {done && <p className="ag-success">✓ Agent added to channel.</p>}
              <div className="ch-form-actions">
                <button type="button" className="ch-btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
                <button type="button" className="ch-btn-primary" onClick={handleAdd} disabled={submitting || done || !selectedChannel}>
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

// ── Edit-profile modal ───────────────────────────────────────────────────────

type EditProfileModalProps = {
  agent: AgentRecord;
  ws: AdminRelayWs;
  onClose: () => void;
  onSaved: (pubkey: string, name: string, picture: string) => void;
};

function EditProfileModal({ agent, ws, onClose, onSaved }: EditProfileModalProps) {
  const [name, setName]       = useState(agent.name ?? "");
  const [picture, setPicture] = useState(agent.picture ?? "");
  const [about, setAbout]     = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await post<SignProfileResponse>("/agents/sign-profile", {
        name: name || undefined,
        picture: picture || undefined,
        about: about || undefined,
      });
      ws.publishSigned(resp.kind0);
      ws.publishSigned(resp.kind10100);
      onSaved(agent.pubkey, resp.kind0.content ? JSON.parse(resp.kind0.content).name ?? name : name, picture);
      setDone(true);
      setTimeout(onClose, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update profile.");
      setSubmitting(false);
    }
  }

  return (
    <div className="ch-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ch-modal" role="dialog" aria-modal="true">
        <div className="ch-modal-header">
          <h2 className="ch-modal-title">Edit agent profile</h2>
          <button type="button" className="ch-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ch-form">
          <p className="ag-agent-hint">
            Pubkey: <code title={agent.pubkey}>{short(agent.pubkey)}</code>
          </p>
          <div className="ch-field">
            <label className="ch-label" htmlFor="ag-name">Display name</label>
            <input
              id="ag-name"
              className="ch-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Buzz AI"
              disabled={submitting || done}
            />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="ag-picture">Avatar URL</label>
            <input
              id="ag-picture"
              className="ch-input"
              type="url"
              value={picture}
              onChange={(e) => setPicture(e.target.value)}
              placeholder="https://example.com/avatar.png"
              disabled={submitting || done}
            />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="ag-about">About</label>
            <input
              id="ag-about"
              className="ch-input"
              type="text"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="AI agent powered by Buzz relay"
              disabled={submitting || done}
            />
          </div>
          {error && <p className="ch-error" role="alert">{error}</p>}
          {done && <p className="ag-success">✓ Profile updated.</p>}
          <div className="ch-form-actions">
            <button type="button" className="ch-btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
            <button type="button" className="ch-btn-primary" onClick={handleSave} disabled={submitting || done}>
              {submitting ? "Saving…" : "Save profile"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function Agents() {
  const [agents,   setAgents]   = useState<Map<string, AgentRecord>>(new Map());
  const [channels, setChannels] = useState<Map<string, ChannelRecord>>(new Map());
  const [loading,  setLoading]  = useState(true);
  const [wsError,  setWsError]  = useState<string | null>(null);
  const [addTarget,  setAddTarget]  = useState<AgentRecord | null>(null);
  const [editTarget, setEditTarget] = useState<AgentRecord | null>(null);
  const [acpPubkey, setAcpPubkey]   = useState<string | null>(null);

  const wsRef          = useRef<AdminRelayWs | null>(null);
  const agentsRef      = useRef<Map<string, AgentRecord>>(new Map());
  const channelsRef    = useRef<Map<string, ChannelRecord>>(new Map());
  // All pubkeys seen in any kind:39002 member list, keyed by pubkey → Set<groupId>
  const memberMapRef   = useRef<Map<string, Set<string>>>(new Map());
  const phase1EoseRef  = useRef(0);
  const membersUnsubRef = useRef<(() => void) | null>(null);

  // Fetch ACP pubkey from relay-info.json for the "setup profile" affordance.
  useEffect(() => {
    fetch("/assets/relay-info.json")
      .then((r) => r.ok ? r.json() as Promise<{ acp_pubkey?: string }> : null)
      .then((d) => { if (d?.acp_pubkey) setAcpPubkey(d.acp_pubkey); })
      .catch(() => {/* no ACP pubkey available */});
  }, []);

  function subscribeToMembers() {
    const ws = wsRef.current;
    if (!ws) return;
    const groupIds = Array.from(channelsRef.current.keys());
    if (groupIds.length === 0) {
      setLoading(false);
      return;
    }
    const unsub = ws.subscribe(
      { kinds: [KIND_GROUP_MEMBERS], "#d": groupIds, limit: 2000 },
      handleMembers,
      () => setLoading(false),
    );
    membersUnsubRef.current = unsub;
  }

  const handleMetadata = useCallback((ev: NostrEvent) => {
    const tags = ev.tags as string[][];
    const groupId = tags.find((t) => t[0] === "d")?.[1];
    if (!groupId) return;
    const name = tags.find((t) => t[0] === "name")?.[1] ?? groupId;
    if (tags.some((t) => t[0] === "hidden")) return; // skip DM channels
    channelsRef.current.set(groupId, { groupId, name });
    setChannels(new Map(channelsRef.current));
  }, []);

  function afterPhase1Eose() {
    phase1EoseRef.current += 1;
    if (phase1EoseRef.current >= 2) subscribeToMembers();
  }

  const handleMembers = useCallback((ev: NostrEvent) => {
    const tags = ev.tags as string[][];
    const groupId = tags.find((t) => t[0] === "d")?.[1];
    if (!groupId) return;

    // Track all pubkeys in this channel's member list.
    for (const t of tags.filter((t) => t[0] === "p" && t[1])) {
      const pk = t[1];
      if (!memberMapRef.current.has(pk)) memberMapRef.current.set(pk, new Set());
      memberMapRef.current.get(pk)!.add(groupId);

      // If we already know this is an agent, assign the channel.
      const existing = agentsRef.current.get(pk);
      if (existing) {
        existing.channelIds.add(groupId);
        agentsRef.current.set(pk, { ...existing });
      }
    }
    setAgents(new Map(agentsRef.current));
  }, []);

  const handleAgentProfile = useCallback((ev: NostrEvent) => {
    const pubkey = ev.pubkey as string;
    let addPolicy: AddPolicy = "unknown";
    let name: string | undefined;
    let about: string | undefined;
    try {
      const parsed = JSON.parse(ev.content as string) as Record<string, unknown>;
      if (["anyone", "owner_only", "nobody"].includes(parsed.channel_add_policy as string)) {
        addPolicy = parsed.channel_add_policy as AddPolicy;
      }
      name  = parsed.name  as string | undefined;
      about = parsed.about as string | undefined;
    } catch { /* invalid JSON */ }

    const existing = agentsRef.current.get(pubkey);
    // Merge channel memberships already collected from kind:39002.
    const channelIds = existing?.channelIds ?? memberMapRef.current.get(pubkey) ?? new Set();
    agentsRef.current.set(pubkey, {
      pubkey,
      addPolicy,
      channelIds,
      name,
    });
    setAgents(new Map(agentsRef.current));
    void about; // suppress lint — kept for future use
  }, []);

  const handleKind0 = useCallback((ev: NostrEvent) => {
    const pubkey = ev.pubkey as string;
    try {
      const parsed = JSON.parse(ev.content as string) as Record<string, unknown>;
      const agent = agentsRef.current.get(pubkey);
      if (agent) {
        agent.name    = (parsed.name    as string | undefined) ?? agent.name;
        agent.picture = (parsed.picture as string | undefined) ?? agent.picture;
        agentsRef.current.set(pubkey, { ...agent });
        setAgents(new Map(agentsRef.current));
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    agentsRef.current    = new Map();
    channelsRef.current  = new Map();
    memberMapRef.current = new Map();
    phase1EoseRef.current = 0;

    const ws = new AdminRelayWs(
      relayWsUrlFromOrigin(),
      () => setWsError(null),
      (msg) => setWsError(msg),
    );
    wsRef.current = ws;

    // Phase 1a: channel metadata
    const unsubMeta = ws.subscribe(
      { kinds: [KIND_GROUP_METADATA], limit: 500 },
      handleMetadata,
      afterPhase1Eose,
    );

    // Phase 1b: agent profiles (kind:10100)
    const unsubAgents = ws.subscribe(
      { kinds: [KIND_AGENT_PROFILE], limit: 500 },
      handleAgentProfile,
      afterPhase1Eose,
    );

    return () => {
      unsubMeta();
      unsubAgents();
      membersUnsubRef.current?.();
      membersUnsubRef.current = null;
      ws.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleMetadata, handleAgentProfile, handleMembers]);

  // After agents are known, subscribe to kind:0 for their pubkeys to get display names.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || agents.size === 0) return;
    const authors = Array.from(agents.keys());
    const unsub = ws.subscribe(
      { kinds: [0], authors, limit: 200 },
      handleKind0,
      () => {/* no EOSE handler needed */},
    );
    return () => unsub();
  }, [agents.size, handleKind0]); // re-run when agent count changes

  async function addToChannel(agentPubkey: string, channelId: string) {
    const ws = wsRef.current;
    if (!ws) throw new Error("Not connected to relay.");
    await ws.publish({
      kind: KIND_ADD_MEMBER,
      tags: [["h", channelId], ["p", agentPubkey], ["role", "member"]],
      content: "",
    });
    const agent = agentsRef.current.get(agentPubkey);
    if (agent) {
      agent.channelIds.add(channelId);
      agentsRef.current.set(agentPubkey, { ...agent });
      setAgents(new Map(agentsRef.current));
    }
  }

  function onProfileSaved(pubkey: string, name: string, picture: string) {
    const agent = agentsRef.current.get(pubkey);
    if (agent) {
      agentsRef.current.set(pubkey, { ...agent, name, picture });
      setAgents(new Map(agentsRef.current));
    }
  }

  // Synthetic ACP entry: show the ACP agent even if it hasn't published kind:10100 yet.
  const agentList = Array.from(agents.values());
  const hasAcpEntry = !acpPubkey || agents.has(acpPubkey);
  if (acpPubkey && !hasAcpEntry) {
    agentList.push({
      pubkey: acpPubkey,
      addPolicy: "unknown",
      channelIds: memberMapRef.current.get(acpPubkey) ?? new Set(),
    });
  }
  agentList.sort((a, b) => a.pubkey.localeCompare(b.pubkey));

  const channelList = Array.from(channels.values()).sort((a, b) => a.name.localeCompare(b.name));
  const isAcp = (pubkey: string) => pubkey === acpPubkey;

  return (
    <div className="page">
      <header className="page-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <p className="page-eyebrow">Workspace</p>
          <h1>Agents</h1>
          <span>
            AI agents connected to this relay. The built-in ACP agent is always listed;
            others appear after publishing a kind:10100 profile.
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

      {!wsError && loading && <div className="state">Loading agents…</div>}

      {!wsError && !loading && agentList.length === 0 && (
        <div className="state">
          <p>No agents found.</p>
          <p style={{ fontSize: ".85rem", color: "rgba(0,0,0,.5)", marginTop: ".5rem" }}>
            Agents appear here once they publish a kind:10100 profile event.
          </p>
        </div>
      )}

      {!wsError && !loading && agentList.length > 0 && (
        <div className="ag-table-wrap">
          <table className="ag-table">
            <thead>
              <tr>
                <th>Agent</th>
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
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {agent.picture && (
                          <img
                            src={agent.picture}
                            alt=""
                            style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        )}
                        <div>
                          {agent.name && (
                            <div style={{ fontSize: ".8rem", fontWeight: 600 }}>{agent.name}</div>
                          )}
                          <code className="ag-pubkey" title={agent.pubkey} style={{ fontSize: ".72rem" }}>
                            {short(agent.pubkey)}
                          </code>
                          {isAcp(agent.pubkey) && (
                            <span className="badge ag-badge-green" style={{ marginLeft: 6, fontSize: ".65rem" }}>
                              built-in
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${cls}`}>{text}</span>
                    </td>
                    <td className="ag-channels">
                      {agentChannels.length === 0 ? (
                        <span className="ag-empty">No channels</span>
                      ) : (
                        agentChannels.map((ch) => (
                          <span key={ch.groupId} className="ag-channel-tag">{ch.name}</span>
                        ))
                      )}
                    </td>
                    <td className="ag-actions" style={{ whiteSpace: "nowrap" }}>
                      {isAcp(agent.pubkey) && wsRef.current && (
                        <button
                          type="button"
                          className="ch-btn-secondary ag-add-btn"
                          style={{ marginRight: 6 }}
                          onClick={() => setEditTarget(agent)}
                          title="Edit profile"
                        >
                          Edit profile
                        </button>
                      )}
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

      {editTarget && wsRef.current && (
        <EditProfileModal
          agent={editTarget}
          ws={wsRef.current}
          onClose={() => setEditTarget(null)}
          onSaved={onProfileSaved}
        />
      )}
    </div>
  );
}
