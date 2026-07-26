/** Domain types for NIP-29 groups and chat messages. */

export type ChannelType = "stream" | "forum" | "workflow";

export interface Channel {
  /** The NIP-29 group ID — `d` tag on kind 39000 events. */
  groupId: string;
  name: string;
  about?: string;
  picture?: string;
  isPrivate: boolean;
  channelType: ChannelType;
  /** Model ID for workflow channels (e.g. "claude-sonnet-4-20250514"). */
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
export const KIND_CREATE_GROUP = 9007;
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

export const AI_MODELS: ModelPreset[] = [
  {
    id: "claude",
    name: "Claude",
    provider: "Anthropic",
    description: "Anthropic's Claude assistant.",
    defaultModel: "claude-opus-4-5",
  },
  {
    id: "codex-acp",
    name: "Codex",
    provider: "OpenAI",
    description: "OpenAI's Codex coding agent.",
    defaultModel: "gpt-4o",
  },
];
