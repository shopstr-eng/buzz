/**
 * NIP-44 decrypt from an arbitrary peer — for agent→owner envelopes like
 * engrams (kind 30174), which use the conversation key between the agent
 * (event author) and the owner (p-tag). nsec login: local conversation key.
 * NIP-07: extension-provided nip44.decrypt.
 */

import { nip44 } from "nostr-tools";
import { getSecretKeyBytes, loadIdentity } from "./identity";
import { ensureNip46Signer } from "./nip46-signer";

export type PeerDecryptor = (peerPubkey: string, ciphertext: string) => Promise<string>;

export function getPeerDecryptor(): PeerDecryptor | null {
  const identity = loadIdentity();
  if (!identity) return null;

  if (identity.type === "nsec") {
    const key = getSecretKeyBytes();
    if (!key) return null;
    const convKeys = new Map<string, Uint8Array>();
    return async (peer, ct) => {
      let convKey = convKeys.get(peer);
      if (!convKey) {
        convKey = nip44.v2.utils.getConversationKey(key, peer);
        convKeys.set(peer, convKey);
      }
      return nip44.v2.decrypt(ct, convKey);
    };
  }

  if (identity.type === "nip46") {
    return async (peer, ct) => (await ensureNip46Signer()).nip44Decrypt(peer, ct);
  }

  const ext = window.nostr as
    | { nip44?: { decrypt: (pk: string, ct: string) => Promise<string> } }
    | undefined;
  if (!ext?.nip44) return null;
  const nip44Ext = ext.nip44;
  return (peer, ct) => nip44Ext.decrypt(peer, ct);
}
