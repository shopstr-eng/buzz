/**
 * Admin-panel session identity.
 *
 * Supports NIP-07 (window.nostr) and nsec / hex secret keys stored in
 * sessionStorage (cleared on tab close, never sent over the network).
 */

import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";

const KEY_NSEC = "buzz_admin_nsec_v1";

// ── storage ───────────────────────────────────────────────────────────────

export function hasStoredNsec(): boolean {
  return sessionStorage.getItem(KEY_NSEC) !== null;
}

export function getStoredNsecHex(): string | null {
  return sessionStorage.getItem(KEY_NSEC);
}

export function storeNsec(input: string): string {
  const trimmed = input.trim();
  let hexKey: string;

  if (trimmed.startsWith("nsec")) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("Not a valid nsec.");
    hexKey = bytesToHex(decoded.data as Uint8Array);
  } else if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    hexKey = trimmed.toLowerCase();
  } else {
    throw new Error(
      "Enter a valid nsec (nsec1…) or 64-character hex secret key.",
    );
  }

  // Validate the key produces a real pubkey before storing.
  getPublicKey(hexToBytes(hexKey));
  sessionStorage.setItem(KEY_NSEC, hexKey);
  return hexKey;
}

export function clearStoredNsec(): void {
  sessionStorage.removeItem(KEY_NSEC);
}

// ── signing ───────────────────────────────────────────────────────────────

export interface EventTemplate {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export function signWithStoredNsec(template: EventTemplate): string {
  const hex = getStoredNsecHex();
  if (!hex) throw new Error("No secret key stored.");
  const key = hexToBytes(hex);
  const signed = finalizeEvent(template, key);
  return btoa(JSON.stringify(signed));
}

// ── helpers ───────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
