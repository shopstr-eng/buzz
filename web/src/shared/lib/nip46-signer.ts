/**
 * NIP-46 remote signer ("bunker") session management.
 *
 * A session is a bunker:// URI (or the signer's NIP-05 address) plus a
 * disposable client keypair generated at connect time. Both are kept in
 * sessionStorage (cleared on tab close, like the nsec identity) so hot
 * reloads can restore the session without re-pasting the URI. The user key
 * never touches this app — all signing and NIP-44/NIP-04 operations are
 * remote procedure calls to the signer over relay-published kind:24133
 * events.
 *
 * The BunkerSigner instance is memoized at module level; consumers obtain it
 * through ensureNip46Signer(), which reconnects lazily on first use after a
 * reload.
 */

import { generateSecretKey } from "nostr-tools/pure";
import {
  BunkerSigner,
  parseBunkerInput,
  type BunkerPointer,
  type ClientMetadata,
} from "nostr-tools/nip46";

const KEY_NIP46 = "buzz_nip46_v1";
/** connect / get_public_key wait this long before giving up. */
const HANDSHAKE_TIMEOUT_MS = 45_000;

interface StoredNip46Session {
  /** Original user input — bunker:// URI or signer NIP-05 address. */
  input: string;
  /** hex-encoded disposable client secret key (deleted on logout). */
  clientSecretKey: string;
}

let cached: Promise<BunkerSigner> | null = null;

function clientMetadata(): ClientMetadata {
  return { name: "Buzz", url: window.location.origin };
}

/** NIP-46 auth challenge: the signer asks the user to authenticate in a browser window. */
function onAuthUrl(url: string): void {
  window.open(url, "_blank", "noopener");
}

async function withTimeout<T>(p: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), HANDSHAKE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function connectSigner(bp: BunkerPointer, clientKey: Uint8Array): Promise<BunkerSigner> {
  const signer = BunkerSigner.fromBunker(clientKey, bp, { onauth: onAuthUrl });
  try {
    await withTimeout(
      signer.connect(clientMetadata()),
      "Remote signer did not answer the connect request (check the relays in the bunker link).",
    );
  } catch (err) {
    void signer.close().catch(() => {});
    throw err;
  }
  return signer;
}

/**
 * Fresh login: connect to the signer described by `input` (bunker:// URI or
 * NIP-05 address), persist the session, and return the user pubkey.
 */
export async function loginWithBunkerSession(input: string): Promise<string> {
  const trimmed = input.trim();
  const bp = await parseBunkerInput(trimmed);
  if (!bp) {
    throw new Error("Enter a valid bunker:// connection string or signer NIP-05 address.");
  }
  const clientKey = generateSecretKey();
  const signer = await connectSigner(bp, clientKey);
  let pubkey: string;
  try {
    pubkey = await withTimeout(
      signer.getPublicKey(),
      "Remote signer did not return a public key.",
    );
  } catch (err) {
    // Don't leak a connected-but-unused signer when the handshake dies here.
    void signer.close().catch(() => {});
    throw err;
  }
  const session: StoredNip46Session = {
    input: trimmed,
    clientSecretKey: bytesToHex(clientKey),
  };
  sessionStorage.setItem(KEY_NIP46, JSON.stringify(session));
  cached = Promise.resolve(signer);
  return pubkey;
}

/** Whether a persisted NIP-46 session exists (cheap; no network). */
export function hasNip46Session(): boolean {
  return sessionStorage.getItem(KEY_NIP46) != null;
}

/**
 * The active signer, reconnecting from the persisted session on first use
 * after a reload. Rejects when there is no session (caller should force
 * re-login).
 */
export function ensureNip46Signer(): Promise<BunkerSigner> {
  if (!cached) cached = restoreSession();
  return cached;
}

async function restoreSession(): Promise<BunkerSigner> {
  const raw = sessionStorage.getItem(KEY_NIP46);
  if (!raw) throw new Error("NIP-46 session lost — sign in again.");
  try {
    const session = JSON.parse(raw) as StoredNip46Session;
    const bp = await parseBunkerInput(session.input);
    if (!bp) throw new Error("stored bunker address no longer resolves");
    return await connectSigner(bp, hexToBytes(session.clientSecretKey));
  } catch (err) {
    // A dead session must not wedge the app — drop it so the next getSignFn
    // path forces a clean re-login instead of repeatedly failing.
    sessionStorage.removeItem(KEY_NIP46);
    cached = null;
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Drop the persisted session and close the live signer, if any. */
export function closeNip46Session(): void {
  sessionStorage.removeItem(KEY_NIP46);
  const pending = cached;
  cached = null;
  if (pending) {
    void pending.then((s) => s.close()).catch(() => {});
  }
}

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
