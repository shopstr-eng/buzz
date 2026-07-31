/** Domain types for NIP-29 groups and chat messages. */

export type ChannelType = "stream" | "forum" | "workflow" | "dm";

export interface Channel {
  /** The NIP-29 group ID — `d` tag on kind 39000 events. */
  groupId: string;
  name: string;
  about?: string;
  /** Channel topic — `topic` tag on kind 39000 (set via kind:9002 `["topic", …]`) */
  topic?: string;
  picture?: string;
  isPrivate: boolean;
  channelType: ChannelType;
  /** DM channels: all participant pubkeys (from kind:39000 p tags) */
  participantPubkeys?: string[];
  /** Model ID for workflow channels — an OpenRouter id (e.g. "anthropic/claude-sonnet-4.5"). */
  model?: string;
  memberCount?: number;
}

export interface ChatMessage {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  /** kind 9 = stream, 40002 = buzz V2 */
  kind: number;
  /** "e" tag pointing to the message this replies to, if any */
  replyToId?: string;
  /** Whether this was published by the current user (optimistic) */
  isPending?: boolean;
  /** created_at of the latest applied kind:40003 edit, if any */
  editedAt?: number;
  /** NIP-92 `imeta` tags (uploaded attachments), verbatim from the event */
  imeta?: string[][];
}

/** Nostr event kinds used by Buzz chat */
export const KIND_METADATA = 0;
export const KIND_GROUP_METADATA = 39000;
export const KIND_GROUP_ADMINS = 39001;
export const KIND_GROUP_MEMBERS = 39002;
export const KIND_MEMBER_ADDED_NOTIFICATION = 44100;
export const KIND_MEMBER_REMOVED_NOTIFICATION = 44101;
export const KIND_STREAM_MSG = 9;
export const KIND_STREAM_MSG_V2 = 40002;
export const KIND_STREAM_MSG_EDIT = 40003;
/** NIP-09 deletion */
export const KIND_DELETION = 5;
/** NIP-29 group-scoped deletion (mirrors the relay + desktop) */
export const KIND_NIP29_DELETE = 9005;
/** System rows (join/leave/channel-created/moderation tombstones) */
export const KIND_SYSTEM_MESSAGE = 40099;
export const KIND_CREATE_GROUP = 9007;
/** Open/find a DM channel (idempotent participant-set lookup, relay-side) */
export const KIND_DM_OPEN = 41010;

/** Job lifecycle events, rendered as labeled timeline cards */
export const KIND_JOB_REQUEST = 43001;
export const KIND_JOB_ACCEPTED = 43002;
export const KIND_JOB_PROGRESS = 43003;
export const KIND_JOB_RESULT = 43004;
export const KIND_JOB_CANCEL = 43005;
export const KIND_JOB_ERROR = 43006;

/** Short label for job lifecycle kinds (matches desktop headlines) */
export function jobKindLabel(kind: number): string | null {
  switch (kind) {
    case KIND_JOB_REQUEST: return "Job requested";
    case KIND_JOB_ACCEPTED: return "Job accepted";
    case KIND_JOB_PROGRESS: return "Progress update";
    case KIND_JOB_RESULT: return "Job result";
    case KIND_JOB_CANCEL: return "Job cancelled";
    case KIND_JOB_ERROR: return "Job failed";
    default: return null;
  }
}
export const KIND_AGENT_PROFILE = 10100;

/** NIP-29 group management kinds */
export const KIND_ADD_MEMBER = 9000;
export const KIND_REMOVE_MEMBER = 9001;
export const KIND_EDIT_METADATA = 9002;

/** AI model presets for workflow channels */
export interface ModelPreset {
  id: string;
  name: string;
  provider: string;
  description: string;
  /**
   * Default model identifier sent to the ACP as an agent_config tag.
   * The user can override this in the connect dialog.
   */
  defaultModel?: string;
}

/**
 * Preset ids are OpenRouter model ids: the id is stored in the channel's
 * `model` metadata tag and buzz-acp matches it against the agent's
 * configured model (OPENAI_COMPAT_MODEL via the keyless OpenRouter path).
 */
export const AI_MODELS: ModelPreset[] = [
  {
    id: "anthropic/claude-opus-4.5",
    name: "Claude Opus 4.5",
    provider: "OpenRouter",
    description: "Anthropic's flagship model, via OpenRouter.",
    defaultModel: "anthropic/claude-opus-4.5",
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    provider: "OpenRouter",
    description: "Anthropic's fast everyday model, via OpenRouter.",
    defaultModel: "anthropic/claude-sonnet-4.5",
  },
  {
    id: "openai/gpt-5.2",
    name: "GPT-5.2",
    provider: "OpenRouter",
    description: "OpenAI's flagship model, via OpenRouter.",
    defaultModel: "openai/gpt-5.2",
  },
  {
    id: "google/gemini-3-pro",
    name: "Gemini 3 Pro",
    provider: "OpenRouter",
    description: "Google's frontier model, via OpenRouter.",
    defaultModel: "google/gemini-3-pro",
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    provider: "OpenRouter",
    description: "Moonshot's open-weight model, via OpenRouter.",
    defaultModel: "moonshotai/kimi-k3",
  },
];

/**
 * Preset identifiers from before the OpenRouter migration. Saved channel
 * templates (localStorage) may still hold these as either the preset id or
 * the preset name.
 */
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  claude: "anthropic/claude-opus-4.5",
  Claude: "anthropic/claude-opus-4.5",
  "codex-acp": "openai/gpt-5.2",
  Codex: "openai/gpt-5.2",
};

/**
 * Resolve a stored model value — a current preset id, a preset name, or a
 * legacy pre-OpenRouter identifier — back to its preset. Returns undefined
 * for unknown values so callers can fall back to "no preset selected".
 */
export function findModelPreset(value: string): ModelPreset | undefined {
  const aliased = LEGACY_MODEL_ALIASES[value] ?? value;
  return (
    AI_MODELS.find((m) => m.id === aliased) ??
    AI_MODELS.find((m) => m.name === value)
  );
}
