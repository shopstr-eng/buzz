/**
 * NIP-44 encrypt-to-self helper.
 *  - nsec login: local secret key via nostr-tools.
 *  - NIP-07 login: window.nostr.nip44 (extension support optional) — returns
 *    null when the extension doesn't expose NIP-44.
 *  - NIP-46 login: proxied to the remote signer (async variant only).
 */

import { nip44 } from "nostr-tools";
import { getPublicKey } from "nostr-tools/pure";
import { loadIdentity, getSecretKeyBytes } from "./identity";
import { ensureNip46Signer } from "./nip46-signer";

export interface Nip44Self {
  encrypt: (plaintext: string) => string;
  decrypt: (ciphertext: string) => string;
}

export function getNip44Self(): Nip44Self | null {
  const identity = loadIdentity();
  if (!identity) return null;

  if (identity.type === "nsec") {
    const key = getSecretKeyBytes();
    if (!key) return null;
    const pub = getPublicKey(key);
    const convKey = nip44.v2.utils.getConversationKey(key, pub);
    return {
      encrypt: (pt) => nip44.v2.encrypt(pt, convKey),
      decrypt: (ct) => nip44.v2.decrypt(ct, convKey),
    };
  }

  // NIP-07: extension-provided nip44 (encrypt/decrypt to own pubkey).
  const ext = window.nostr as
    | { nip44?: { encrypt: (pk: string, pt: string) => Promise<string>; decrypt: (pk: string, ct: string) => Promise<string> } }
    | undefined;
  if (!ext?.nip44) return null;
  const nip44Ext = ext.nip44;
  const me = identity.pubkey;
  // Extension API is async; keep the sync interface by throwing on misuse —
  // reminders gate on `getNip44SelfAsync` below instead.
  void me;
  void nip44Ext;
  return null;
}

/** Async variant covering NIP-07 extensions. */
export async function getNip44SelfAsync(): Promise<{
  encrypt: (plaintext: string) => Promise<string>;
  decrypt: (ciphertext: string) => Promise<string>;
} | null> {
  const sync = getNip44Self();
  if (sync) {
    return {
      encrypt: async (pt) => sync.encrypt(pt),
      decrypt: async (ct) => sync.decrypt(ct),
    };
  }

  const identity = loadIdentity();
  if (identity?.type === "nip46") {
    const me = identity.pubkey;
    return {
      encrypt: async (pt) => (await ensureNip46Signer()).nip44Encrypt(me, pt),
      decrypt: async (ct) => (await ensureNip46Signer()).nip44Decrypt(me, ct),
    };
  }
  if (identity?.type !== "nip07") return null;
  const ext = window.nostr as
    | { nip44?: { encrypt: (pk: string, pt: string) => Promise<string>; decrypt: (pk: string, ct: string) => Promise<string> } }
    | undefined;
  if (!ext?.nip44) return null;
  const me = identity.pubkey;
  return {
    encrypt: (pt) => ext.nip44!.encrypt(me, pt),
    decrypt: (ct) => ext.nip44!.decrypt(me, ct),
  };
}
