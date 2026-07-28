/**
 * Deterministic fallback avatar color for a pubkey (same palette/algorithm as
 * the chat Avatar). Used wherever a profile picture is missing or fails to
 * load, so a user's fallback color is consistent across surfaces.
 */
export function avatarColor(pubkey: string): string {
  const colors = [
    "#e35b4e", "#e8864d", "#d4a017", "#4caf73",
    "#3b9dd3", "#7b72e9", "#c264d0", "#e05b8c",
  ];
  let hash = 0;
  for (let i = 0; i < pubkey.length; i++) {
    hash = (hash * 31 + pubkey.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}
