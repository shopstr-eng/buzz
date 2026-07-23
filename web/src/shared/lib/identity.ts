/**
 * Browser-session identity management.
 *
 * Supports two modes:
 *   nip07 — browser extension (window.nostr); no key material stored.
 *   nsec  — hex secret key stored in sessionStorage (cleared on tab close).
 *
 * The identity is persisted across hot-reloads but not across tab close.
 */

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from "nostr-tools";
import type {
  UnsignedNostrEvent,
  SignedNostrEvent,
} from "@/shared/lib/nostr-signer";

export type IdentityType = "nip07" | "nsec";

export interface StoredIdentity {
  pubkey: string;
  type: IdentityType;
}

const KEY_IDENTITY = "buzz_identity_v1";
const KEY_NSEC = "buzz_nsec_v1";

// ── storage helpers ────────────────────────────────────────────────────────

export function loadIdentity(): StoredIdentity | null {
  try {
    const raw = sessionStorage.getItem(KEY_IDENTITY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredIdentity;
  } catch {
    return null;
  }
}

export function clearIdentity(): void {
  sessionStorage.removeItem(KEY_IDENTITY);
  sessionStorage.removeItem(KEY_NSEC);
}

// ── NIP-07 ─────────────────────────────────────────────────────────────────

export function hasNip07(): boolean {
  return typeof window !== "undefined" && window.nostr != null;
}

export async function loginWithNip07(): Promise<StoredIdentity> {
  if (!window.nostr) throw new Error("No NIP-07 extension found.");
  const pubkey = await window.nostr.getPublicKey();
  const identity: StoredIdentity = { pubkey, type: "nip07" };
  sessionStorage.setItem(KEY_IDENTITY, JSON.stringify(identity));
  return identity;
}

// ── generate new identity ─────────────────────────────────────────────────

export interface GeneratedIdentity {
  identity: StoredIdentity;
  /** bech32-encoded nsec — show this to the user once so they can save it */
  nsec: string;
}

export function generateNewIdentity(): GeneratedIdentity {
  const secretKeyBytes = generateSecretKey();
  const pubkey = getPublicKey(secretKeyBytes);
  const nsec = nip19.nsecEncode(secretKeyBytes);
  const hexKey = bytesToHex(secretKeyBytes);
  const identity: StoredIdentity = { pubkey, type: "nsec" };
  sessionStorage.setItem(KEY_IDENTITY, JSON.stringify(identity));
  sessionStorage.setItem(KEY_NSEC, hexKey);
  return { identity, nsec };
}

// ── nsec ────────────────────────────────────────────────────────────────────

export function loginWithNsec(input: string): StoredIdentity {
  let secretKeyBytes: Uint8Array;

  const trimmed = input.trim();
  if (trimmed.startsWith("nsec")) {
    // bech32 nsec
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("Not a valid nsec.");
    secretKeyBytes = decoded.data as Uint8Array;
  } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    // raw hex
    secretKeyBytes = hexToBytes(trimmed);
  } else {
    throw new Error("Enter a valid nsec (nsec1…) or 64-character hex secret key.");
  }

  const pubkey = getPublicKey(secretKeyBytes);
  const hexKey = bytesToHex(secretKeyBytes);

  const identity: StoredIdentity = { pubkey, type: "nsec" };
  sessionStorage.setItem(KEY_IDENTITY, JSON.stringify(identity));
  sessionStorage.setItem(KEY_NSEC, hexKey);
  return identity;
}

// ── signing ─────────────────────────────────────────────────────────────────

/**
 * Returns a signing function appropriate for the stored identity, or null
 * if no identity is loaded.
 */
export function getSignFn():
  | ((t: UnsignedNostrEvent) => Promise<SignedNostrEvent>)
  | null {
  const identity = loadIdentity();
  if (!identity) return null;

  if (identity.type === "nip07") {
    return async (template) => {
      if (!window.nostr) throw new Error("NIP-07 extension lost.");
      return window.nostr.signEvent(template) as Promise<SignedNostrEvent>;
    };
  }

  if (identity.type === "nsec") {
    const hex = sessionStorage.getItem(KEY_NSEC);
    if (!hex) return null;
    const key = hexToBytes(hex);
    return async (template) =>
      finalizeEvent(
        { ...template, created_at: template.created_at ?? Math.floor(Date.now() / 1000) },
        key,
      ) as SignedNostrEvent;
  }

  return null;
}

// ── byte helpers ─────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length;
  const bytes = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
