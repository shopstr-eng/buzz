/**
 * Browser-session identity management.
 *
 * Supports three modes:
 *   nip07 — browser extension (window.nostr); no key material stored.
 *   nsec  — hex secret key stored in sessionStorage (cleared on tab close).
 *           NIP-49 ncryptsec inputs are decrypted with a password at login.
 *   nip46 — remote signer (bunker); only a disposable client keypair and the
 *           bunker address are stored, the user key never enters the app.
 *
 * The identity is persisted across hot-reloads but not across tab close.
 */

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
} from "nostr-tools";
import { decrypt as nip49Decrypt } from "nostr-tools/nip49";
import type {
  UnsignedNostrEvent,
  SignedNostrEvent,
} from "@/shared/lib/nostr-signer";
import {
  closeNip46Session,
  ensureNip46Signer,
  hasNip46Session,
  loginWithBunkerSession,
} from "./nip46-signer";

export type IdentityType = "nip07" | "nsec" | "nip46";

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
  closeNip46Session();
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

export function loginWithNsec(input: string, password?: string): StoredIdentity {
  let secretKeyBytes: Uint8Array;

  const trimmed = input.trim();
  if (trimmed.startsWith("ncryptsec1")) {
    // NIP-49 password-encrypted key — decrypt, then continue exactly as a
    // raw-key login. Only the decrypted key is kept, never the password.
    if (!password) {
      throw new Error("This key is password-protected — enter its password.");
    }
    try {
      secretKeyBytes = nip49Decrypt(trimmed, password.normalize("NFKC"));
    } catch {
      throw new Error("Wrong password (or corrupted ncryptsec key).");
    }
  } else if (trimmed.startsWith("nsec")) {
    // bech32 nsec
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("Not a valid nsec.");
    secretKeyBytes = decoded.data as Uint8Array;
  } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    // raw hex
    secretKeyBytes = hexToBytes(trimmed);
  } else {
    throw new Error("Enter a valid nsec (nsec1…), ncryptsec (ncryptsec1…), or 64-character hex secret key.");
  }

  const pubkey = getPublicKey(secretKeyBytes);
  const hexKey = bytesToHex(secretKeyBytes);

  const identity: StoredIdentity = { pubkey, type: "nsec" };
  sessionStorage.setItem(KEY_IDENTITY, JSON.stringify(identity));
  sessionStorage.setItem(KEY_NSEC, hexKey);
  return identity;
}

// ── NIP-46 remote signer ────────────────────────────────────────────────────

/**
 * Log in via a NIP-46 remote signer (bunker:// URI or signer NIP-05 address).
 * Connects over the relays named in the URI; the user key stays in the
 * signer — only a disposable client keypair is stored (sessionStorage).
 */
export async function loginWithBunker(input: string): Promise<StoredIdentity> {
  const pubkey = await loginWithBunkerSession(input);
  const identity: StoredIdentity = { pubkey, type: "nip46" };
  sessionStorage.setItem(KEY_IDENTITY, JSON.stringify(identity));
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

  if (identity.type === "nip46") {
    // No persisted session (e.g. storage cleared) → no signer at all; the
    // RelayProvider treats a null signFn as "identity lost, force re-login".
    if (!hasNip46Session()) return null;
    // Lazily reconnects on first use after a reload (ensureNip46Signer
    // memoizes). No timeout here — the user may approve slowly on the device.
    return async (template) => {
      const signer = await ensureNip46Signer().catch((err) => {
        // Restore failed (bunker rejects the reconnect, dead relays): drop
        // the identity and reload into a clean login instead of wedging the
        // app behind a signer that can never produce a signature.
        clearIdentity();
        window.location.reload();
        throw err;
      });
      return signer.signEvent({
        ...template,
        created_at: template.created_at ?? Math.floor(Date.now() / 1000),
      }) as Promise<SignedNostrEvent>;
    };
  }

  return null;
}

// ── byte helpers ─────────────────────────────────────────────────────────────

/** Secret key bytes for the nsec identity (null for NIP-07 / logged out). */
export function getSecretKeyBytes(): Uint8Array | null {
  const hex = sessionStorage.getItem(KEY_NSEC);
  return hex ? hexToBytes(hex) : null;
}

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
