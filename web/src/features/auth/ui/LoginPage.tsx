import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, Puzzle, Eye, EyeOff, AlertCircle, Sparkles, Copy, Check } from "lucide-react";
import { useRelay } from "@/shared/context/relay-context";
import { hasNip07 } from "@/shared/lib/identity";
import { generateNewIdentity } from "@/shared/lib/identity";
import buzzAppIcon from "@/assets/app-icon@3x.png";

export function LoginPage() {
  const { loginWithExtension, loginWithKey } = useRelay();
  const navigate = useNavigate();
  const [nsec, setNsec] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nip07Available = hasNip07();

  // Generate-new-identity state
  const [generatedNsec, setGeneratedNsec] = useState<string | null>(null);
  const [keySaved, setKeySaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleNip07() {
    setError(null);
    setLoading(true);
    try {
      await loginWithExtension();
      await navigate({ to: "/channels" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extension login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleNsec(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      loginWithKey(nsec);
      await navigate({ to: "/channels" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid secret key.");
    } finally {
      setLoading(false);
    }
  }

  function handleGenerate() {
    const { nsec } = generateNewIdentity();
    setGeneratedNsec(nsec);
    setKeySaved(false);
    setCopied(false);
  }

  async function handleCopy() {
    if (!generatedNsec) return;
    await navigator.clipboard.writeText(generatedNsec);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleContinueWithGenerated() {
    await navigate({ to: "/channels" });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F3F3F3] px-4 dark:bg-[#111111]">
      <div className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-8 shadow-sm dark:border-white/10 dark:bg-[#1C1C1C]">
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
          Use your Nostr identity to join the workspace.
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

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* divider */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
            <span className="text-xs text-black/40 dark:text-white/40">new to Nostr?</span>
            <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
          </div>

          {/* Generate new identity */}
          {!generatedNsec ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/15 bg-transparent px-4 py-2.5 text-sm font-medium text-black transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:text-white dark:hover:bg-white/5"
            >
              <Sparkles className="h-4 w-4" />
              Generate a new identity
            </button>
          ) : (
            <div className="space-y-3 rounded-lg border border-black/10 bg-black/[0.02] p-4 dark:border-white/10 dark:bg-white/[0.02]">
              <p className="text-xs font-medium text-black/70 dark:text-white/70">
                Your new secret key
              </p>
              <div className="relative">
                <input
                  readOnly
                  type="text"
                  value={generatedNsec}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 pr-10 font-mono text-xs text-black dark:border-white/15 dark:bg-[#1C1C1C] dark:text-white"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
                  aria-label="Copy secret key"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <strong>Save this key before continuing.</strong> It's your password — if you lose it, there's no recovery.
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-black/70 dark:text-white/60">
                <input
                  type="checkbox"
                  checked={keySaved}
                  onChange={(e) => setKeySaved(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-black/30 accent-black"
                />
                I've saved my secret key somewhere safe
              </label>
              <button
                type="button"
                onClick={handleContinueWithGenerated}
                disabled={!keySaved}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
              >
                Continue
              </button>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-black/40 dark:text-white/30">
          Your key is stored in this browser tab only and cleared when you close it.
        </p>
      </div>
    </div>
  );
}
