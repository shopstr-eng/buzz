import { useCallback, useEffect, useRef, useState } from "react";
import { AdminRelayWs, relayWsUrlFromOrigin } from "./relay-ws";
import type { NostrEvent } from "./relay-ws";

// NIP-29 event kinds
const KIND_CREATE_GROUP = 9007;
const KIND_EDIT_METADATA = 9002;
const KIND_DELETE_GROUP = 9008;
const KIND_GROUP_METADATA = 39000;

type ChannelType = "stream" | "forum" | "workflow";
type Visibility = "open" | "private";

type AdminChannel = {
  groupId: string;
  name: string;
  about: string;
  channelType: string;
  visibility: Visibility;
  archived: boolean;
};

function eventToChannel(ev: NostrEvent): AdminChannel | null {
  const tags = ev.tags as string[][];
  const groupId = tags.find((t) => t[0] === "d")?.[1];
  if (!groupId) return null;
  const name = tags.find((t) => t[0] === "name")?.[1] ?? groupId;
  const about = tags.find((t) => t[0] === "about")?.[1] ?? "";
  const channelType = tags.find((t) => t[0] === "t")?.[1] ?? "stream";
  const visibility: Visibility = tags.some((t) => t[0] === "private")
    ? "private"
    : "open";
  const archived = tags.some((t) => t[0] === "archived" && t[1] === "true");
  // Skip hidden channels (DMs)
  if (tags.some((t) => t[0] === "hidden")) return null;
  return { groupId, name, about, channelType, visibility, archived };
}

type FormState = {
  name: string;
  channelType: ChannelType;
  visibility: Visibility;
  about: string;
};

const BLANK_FORM: FormState = {
  name: "",
  channelType: "stream",
  visibility: "open",
  about: "",
};

function ChannelTypeLabel({ type }: { type: string }) {
  const labels: Record<string, string> = {
    stream: "Stream",
    forum: "Forum",
    workflow: "Workflow",
    dm: "DM",
  };
  const colours: Record<string, string> = {
    stream: "badge-stream",
    forum: "badge-forum",
    workflow: "badge-workflow",
    dm: "badge-dm",
  };
  return (
    <span className={`badge ${colours[type] ?? "badge-stream"}`}>
      {labels[type] ?? type}
    </span>
  );
}

function VisibilityLabel({ vis }: { vis: Visibility }) {
  return (
    <span className={`badge ${vis === "private" ? "badge-private" : "badge-open"}`}>
      {vis === "private" ? "Private" : "Open"}
    </span>
  );
}

type ModalProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
};

function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className="ch-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ch-modal" role="dialog" aria-modal="true">
        <div className="ch-modal-header">
          <h2 className="ch-modal-title">{title}</h2>
          <button type="button" className="ch-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

type ChannelFormProps = {
  initial: FormState;
  submitting: boolean;
  error: string | null;
  onSubmit: (form: FormState) => void;
  onCancel: () => void;
  submitLabel: string;
};

function ChannelForm({ initial, submitting, error, onSubmit, onCancel, submitLabel }: ChannelFormProps) {
  const [form, setForm] = useState<FormState>(initial);

  function field<K extends keyof FormState>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [key]: e.target.value as FormState[K] }));
    };
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(form); }} className="ch-form">
      <div className="ch-field">
        <label className="ch-label" htmlFor="ch-name">Channel name</label>
        <input
          id="ch-name"
          className="ch-input"
          value={form.name}
          onChange={field("name")}
          placeholder="e.g. general"
          required
          autoFocus
        />
      </div>
      <div className="ch-field-row">
        <div className="ch-field">
          <label className="ch-label" htmlFor="ch-type">Type</label>
          <select id="ch-type" className="ch-select" value={form.channelType} onChange={field("channelType")}>
            <option value="stream">Stream — real-time chat</option>
            <option value="forum">Forum — threaded discussion</option>
            <option value="workflow">Workflow — task / automation</option>
          </select>
        </div>
        <div className="ch-field">
          <label className="ch-label" htmlFor="ch-vis">Visibility</label>
          <select id="ch-vis" className="ch-select" value={form.visibility} onChange={field("visibility")}>
            <option value="open">Open — all members</option>
            <option value="private">Private — invited only</option>
          </select>
        </div>
      </div>
      <div className="ch-field">
        <label className="ch-label" htmlFor="ch-about">Description <span className="ch-optional">(optional)</span></label>
        <textarea
          id="ch-about"
          className="ch-textarea"
          value={form.about}
          onChange={field("about")}
          placeholder="What is this channel for?"
          rows={3}
        />
      </div>
      {error && <p className="ch-error" role="alert">{error}</p>}
      <div className="ch-form-actions">
        <button type="button" className="ch-btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button type="submit" className="ch-btn-primary" disabled={submitting || !form.name.trim()}>
          {submitting ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function Channels() {
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsError, setWsError] = useState<string | null>(null);
  const [wsReady, setWsReady] = useState(false);

  // Modals
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminChannel | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminChannel | null>(null);

  // Action state
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const wsRef = useRef<AdminRelayWs | null>(null);
  const seenRef = useRef(new Map<string, NostrEvent>());

  // Handle incoming kind:39000 events
  const handleEvent = useCallback((ev: NostrEvent) => {
    const ch = eventToChannel(ev);
    if (!ch) return;
    const existing = seenRef.current.get(ch.groupId);
    if (!existing || (ev.created_at as number) > (existing.created_at as number)) {
      seenRef.current.set(ch.groupId, ev);
      setChannels(
        Array.from(seenRef.current.values())
          .map(eventToChannel)
          .filter((c): c is AdminChannel => c !== null && !c.archived)
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    }
  }, []);

  // Connect on mount
  useEffect(() => {
    seenRef.current = new Map();
    const url = relayWsUrlFromOrigin();

    const ws = new AdminRelayWs(
      url,
      () => {
        setWsReady(true);
        setWsError(null);
      },
      (msg) => setWsError(msg),
    );
    wsRef.current = ws;

    const unsub = ws.subscribe(
      { kinds: [KIND_GROUP_METADATA], limit: 500 },
      handleEvent,
      () => setLoading(false),
    );

    return () => {
      unsub();
      ws.close();
      wsRef.current = null;
    };
  }, [handleEvent]);

  // After ready, mark loading done if EOSE already came (unlikely race, but safe)
  useEffect(() => {
    if (wsReady && loading) {
      // Give EOSE a moment; if it doesn't arrive the onEose callback handles it.
    }
  }, [wsReady, loading]);

  async function handleCreate(form: FormState) {
    const ws = wsRef.current;
    if (!ws) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const tags: string[][] = [
        ["name", form.name.trim()],
        ["visibility", form.visibility],
        ["channel_type", form.channelType],
      ];
      if (form.about.trim()) tags.push(["about", form.about.trim()]);
      await ws.publish({ kind: KIND_CREATE_GROUP, tags, content: "" });
      setShowCreate(false);
      // The relay will emit a kind:39000 which our subscription will pick up.
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to create channel.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(form: FormState) {
    const ws = wsRef.current;
    if (!ws || !editTarget) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const tags: string[][] = [["h", editTarget.groupId]];
      if (form.name.trim() !== editTarget.name) tags.push(["name", form.name.trim()]);
      if (form.about.trim() !== editTarget.about) tags.push(["about", form.about.trim()]);
      if (form.visibility !== editTarget.visibility) tags.push(["visibility", form.visibility]);
      if (tags.length === 1) { setEditTarget(null); return; } // nothing changed
      await ws.publish({ kind: KIND_EDIT_METADATA, tags, content: "" });
      setEditTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to update channel.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    const ws = wsRef.current;
    if (!ws || !deleteTarget) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await ws.publish({
        kind: KIND_DELETE_GROUP,
        tags: [["h", deleteTarget.groupId]],
        content: "",
      });
      // Optimistically remove from list
      seenRef.current.delete(deleteTarget.groupId);
      setChannels((prev) => prev.filter((c) => c.groupId !== deleteTarget.groupId));
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete channel.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <header className="page-title">
        <div>
          <p className="page-eyebrow">Workspace</p>
          <h1>Channels</h1>
        </div>
        <button
          type="button"
          className="ch-btn-primary"
          onClick={() => { setShowCreate(true); setActionError(null); }}
          disabled={!wsReady}
          title={wsReady ? undefined : "Connecting to relay…"}
        >
          + New channel
        </button>
      </header>

      {wsError && (
        <div className="state error" role="alert">
          <h2>Could not connect to relay</h2>
          <p>{wsError}</p>
          <button type="button" onClick={() => location.reload()}>Retry</button>
        </div>
      )}

      {!wsError && loading && (
        <div className="state">Loading channels…</div>
      )}

      {!wsError && !loading && channels.length === 0 && (
        <div className="state">
          <p>No channels yet.</p>
          <button type="button" className="ch-btn-primary" onClick={() => setShowCreate(true)}>
            Create your first channel
          </button>
        </div>
      )}

      {!wsError && !loading && channels.length > 0 && (
        <table className="ch-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Visibility</th>
              <th>Description</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => (
              <tr key={ch.groupId}>
                <td className="ch-name">{ch.name}</td>
                <td><ChannelTypeLabel type={ch.channelType} /></td>
                <td><VisibilityLabel vis={ch.visibility} /></td>
                <td className="ch-about">{ch.about || <span className="ch-empty">—</span>}</td>
                <td className="ch-actions">
                  <button
                    type="button"
                    className="ch-action-btn"
                    title="Edit channel"
                    onClick={() => { setEditTarget(ch); setActionError(null); }}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="ch-action-btn ch-action-danger"
                    title="Delete channel"
                    onClick={() => { setDeleteTarget(ch); setActionError(null); }}
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create modal */}
      {showCreate && (
        <Modal title="New channel" onClose={() => setShowCreate(false)}>
          <ChannelForm
            initial={BLANK_FORM}
            submitting={submitting}
            error={actionError}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            submitLabel="Create channel"
          />
        </Modal>
      )}

      {/* Edit modal */}
      {editTarget && (
        <Modal title={`Edit — ${editTarget.name}`} onClose={() => setEditTarget(null)}>
          <ChannelForm
            initial={{
              name: editTarget.name,
              channelType: (editTarget.channelType as ChannelType) || "stream",
              visibility: editTarget.visibility,
              about: editTarget.about,
            }}
            submitting={submitting}
            error={actionError}
            onSubmit={handleEdit}
            onCancel={() => setEditTarget(null)}
            submitLabel="Save changes"
          />
        </Modal>
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <Modal title="Delete channel?" onClose={() => setDeleteTarget(null)}>
          <div className="ch-form">
            <p className="ch-delete-msg">
              Permanently delete <strong>{deleteTarget.name}</strong>? This cannot be undone — all messages in this channel will be lost.
            </p>
            {actionError && <p className="ch-error" role="alert">{actionError}</p>}
            <div className="ch-form-actions">
              <button type="button" className="ch-btn-secondary" onClick={() => setDeleteTarget(null)} disabled={submitting}>Cancel</button>
              <button type="button" className="ch-btn-danger" onClick={handleDelete} disabled={submitting}>
                {submitting ? "Deleting…" : "Delete channel"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
