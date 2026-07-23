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
export const KIND_GROUP_METADATA = 39000;
export const KIND_GROUP_ADMINS = 39001;
export const KIND_GROUP_MEMBERS = 39002;
export const KIND_STREAM_MSG = 9;
export const KIND_STREAM_MSG_V2 = 40002;
export const KIND_CREATE_GROUP = 9007;
export const KIND_AGENT_PROFILE = 10100;

/** AI model presets for workflow channels */
export interface ModelPreset {
  id: string;
  name: string;
  provider: string;
}

export const AI_MODELS: ModelPreset[] = [
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "claude-opus-4-20250514", name: "Claude Opus 4", provider: "Anthropic" },
  { id: "gpt-5", name: "GPT-5", provider: "OpenAI" },
  { id: "codex-acp", name: "Codex", provider: "OpenAI" },
];
