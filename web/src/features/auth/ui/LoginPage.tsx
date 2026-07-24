import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, Puzzle, Eye, EyeOff, AlertCircle, Lock } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { hasNip07, loadIdentity } from "@/shared/lib/identity";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import buzzAppIcon from "@/assets/app-icon@3x.png";

// ── Membership check ──────────────────────────────────────────────────────

async function checkMembership(): Promise<{ member: boolean; role: string | null }> {
  const url = `${window.location.origin}/api/me/membership`;
  const auth = await makeNip98AuthHeader(url, "GET");
  const res = await fetch(url, {
    headers: { Authorization: auth, Accept: "application/json" },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(
      typeof json.error === "string" ? json.error : `HTTP ${res.status}`,
    );
  }
  return res.json() as Promise<{ member: boolean; role: string | null }>;
}

// ── Component ─────────────────────────────────────────────────────────────

export function LoginPage() {
  const { loginWithExtension, loginWithKey, logout } = useRelay();
  const navigate = useNavigate();
  const [nsec, setNsec] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nip07Available = hasNip07();

  // ── helpers ──────────────────────────────────────────────────────────────

  /** After a successful identity load, verify the key is a community member. */
  async function verifyAndEnter() {
    const id = loadIdentity();
    if (!id) throw new Error("No identity loaded.");

    let status: { member: boolean; role: string | null };
    try {
      status = await checkMembership();
    } catch (err) {
      // Network / relay error — don't block login, let the WS surface it.
      const msg = err instanceof Error ? err.message : String(err);
      // If the relay explicitly denied auth (401), surface invite-required.
      if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("missing Nostr auth")) {
        throw new Error("not_member");
      }
      throw err;
    }

    if (!status.member) {
      throw new Error("not_member");
    }
  }

  // ── handlers ─────────────────────────────────────────────────────────────

  async function handleNip07() {
    setError(null);
    setLoading(true);
    try {
      await loginWithExtension();       // stores pubkey, sets relay context
      await verifyAndEnter();           // NIP-98 membership check
      await navigate({ to: "/channels" });
    } catch (err) {
      logout();                         // disconnect + clear identity
      if (err instanceof Error && err.message === "not_member") {
        setError("not_member");
      } else {
        setError(err instanceof Error ? err.message : "Extension login failed.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleNsec(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      loginWithKey(nsec);               // stores key, sets relay context
      await verifyAndEnter();           // NIP-98 membership check (signs in-browser, no prompt)
      await navigate({ to: "/channels" });
    } catch (err) {
      logout();                         // disconnect + clear identity
      if (err instanceof Error && err.message === "not_member") {
        setError("not_member");
      } else {
        setError(err instanceof Error ? err.message : "Invalid secret key.");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F3F3F3] px-4 dark:bg-[#111111]">
      <div className="w-full max-w-sm space-y-4">
        {/* Card */}
        <div className="rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-[#1C1C1C]">
          {/* Logo */}
          <div className="flex justify-center">
            <div
              className="h-14 w-14 overflow-hidden bg-black"
              style={{ borderRadius: "22.37%" }}
            >
              <img alt="Buzz" className="h-full w-full" src={buzzAppIcon} />
            </div>
          </div>

          <h1 className="mt-5 text-center text-xl font-semibold text-black dark:text-white">
            Sign in to Buzz
          </h1>
          <p className="mt-1.5 text-center text-sm text-black/50 dark:text-white/50">
            Use your Nostr identity to sign in.
          </p>

          <div className="mt-7 space-y-4">
            {/* NIP-07 */}
            <button
              type="button"
              onClick={handleNip07}
              disabled={loading || !nip07Available}
              title={
                nip07Available
                  ? "Sign in with browser extension"
                  : "No NIP-07 extension detected (install Alby or nos2x)"
              }
              className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
            >
              <Puzzle className="h-4 w-4" />
              {nip07Available
                ? "Continue with browser extension"
                : "No NIP-07 extension found"}
            </button>

            {/* divider */}
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
              <span className="text-xs text-black/40 dark:text-white/40">or</span>
              <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
            </div>

            {/* nsec form */}
            <form onSubmit={handleNsec} className="space-y-3">
              <div>
                <label
                  htmlFor="nsec-input"
                  className="mb-1.5 block text-xs font-medium text-black/70 dark:text-white/70"
                >
                  Secret key (nsec or hex)
                </label>
                <div className="relative">
                  <input
                    id="nsec-input"
                    type={showKey ? "text" : "password"}
                    value={nsec}
                    onChange={(e) => setNsec(e.target.value)}
                    placeholder="nsec1..."
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 pr-10 text-sm text-black placeholder-black/30 outline-none focus:border-black/40 dark:border-white/15 dark:text-white dark:placeholder-white/30 dark:focus:border-white/40"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading || !nsec.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/15 bg-transparent px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-white dark:hover:bg-white/5"
              >
                <KeyRound className="h-4 w-4" />
                Sign in with secret key
              </button>
            </form>

            {/* Error messages */}
            {error === "not_member" ? (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This workspace is invite-only. Your key isn't in this
                  community — ask a workspace admin for an invite link.
                </span>
              </div>
            ) : error ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            ) : null}
          </div>
        </div>

        {/* Invite-only notice */}
        <p className="text-center text-xs text-black/40 dark:text-white/30">
          <Lock className="mr-1 inline h-3 w-3" />
          Members-only workspace — you need an invite link to join.
        </p>
      </div>
    </div>
  );
}
