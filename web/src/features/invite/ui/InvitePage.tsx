import buzzAppIcon from "@/assets/app-icon@3x.png";
import { claimInviteInBrowser } from "@/features/invite/invite-api";
import {
  BUZZ_RELEASES_URL,
  type BuzzDownloadPlatform,
  detectBuzzDownloadPlatform,
  resolveBuzzDownloadUrlForPlatform,
} from "@/shared/lib/buzz-download";
import {
  generateNewIdentity,
  loadIdentity,
  loginWithNsec,
} from "@/shared/lib/identity";
import { hasNip07Provider } from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { Button } from "@/shared/ui/button";
import { Check, Copy, Eye, EyeOff, KeyRound, Puzzle, Sparkles } from "lucide-react";
import * as React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { InviteJoinPolicyNotice } from "./InviteJoinPolicyNotice";

type JoinPolicy = {
  terms_markdown?: string;
  privacy_markdown?: string;
  age_attestation_required: boolean;
  version: string;
};

type PolicyDocument = { title: string; markdown: string };

/** Landing page for a community invite link (`/invite/<code>`). */
export function InvitePage({ code }: { code: string }) {
  const relay = relayWsUrl();
  const host = relay.replace(/^wss?:\/\//, "");
  const [policy, setPolicy] = React.useState<JoinPolicy | null | undefined>(
    undefined,
  );
  const [document, setDocument] = React.useState<PolicyDocument | null>(null);
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);
  const [agreementConfirmed, setAgreementConfirmed] = React.useState(false);
  const [opening, setOpening] = React.useState(false);
  const [joiningBrowser, setJoiningBrowser] = React.useState(false);
  const [browserJoinError, setBrowserJoinError] = React.useState<string | null>(
    null,
  );
  // Identity creation step (shown inline when user has no identity)
  const [identityReady, setIdentityReady] = React.useState(
    () => loadIdentity() !== null || hasNip07Provider(),
  );
  const [showIdentityStep, setShowIdentityStep] = React.useState(false);
  const [idMode, setIdMode] = React.useState<"choose" | "generate" | "nsec">("choose");
  const [genNsec, setGenNsec] = React.useState<string | null>(null);
  const [genKeySaved, setGenKeySaved] = React.useState(false);
  const [genCopied, setGenCopied] = React.useState(false);
  const [nsecInput, setNsecInput] = React.useState("");
  const [showNsecValue, setShowNsecValue] = React.useState(false);
  const [identityError, setIdentityError] = React.useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = React.useState(BUZZ_RELEASES_URL);
  const [needsMacChoice, setNeedsMacChoice] = React.useState(false);
  const [showMacChoice, setShowMacChoice] = React.useState(false);
  const [choosingMacDownload, setChoosingMacDownload] = React.useState(false);
  const choosingMacDownloadRef = React.useRef(false);
  const downloadTriggerRef = React.useRef<HTMLAnchorElement>(null);

  React.useEffect(() => {
    let active = true;
    detectBuzzDownloadPlatform(navigator).then(async (platform) => {
      if (!active) return;
      if (
        platform.operatingSystem === "macos" &&
        platform.architecture === "unknown"
      ) {
        setNeedsMacChoice(true);
        return;
      }
      const url = await resolveBuzzDownloadUrlForPlatform(platform);
      if (active) setDownloadUrl(url);
    });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    fetch("/api/join-policy")
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const config = (await response.json()) as { policy?: JoinPolicy };
        setPolicy(config.policy ?? null);
      })
      .catch(() => setPolicy(undefined));
  }, []);

  const acceptPolicy = async (): Promise<string | undefined> => {
    if (!policy) return undefined;
    const response = await fetch("/api/invites/accept-policy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        policy_version: policy.version,
        age_confirmed: ageConfirmed,
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ((await response.json()) as { receipt: string }).receipt;
  };

  const openInvite = async () => {
    setOpening(true);
    try {
      const receipt = await acceptPolicy();
      const query = new URLSearchParams({ relay, code });
      if (receipt) query.set("policy_receipt", receipt);
      window.location.href = `buzz://join?${query.toString()}`;
    } finally {
      setOpening(false);
    }
  };

  const joinInBrowser = async () => {
    if (!identityReady) {
      setShowIdentityStep(true);
      return;
    }
    setBrowserJoinError(null);
    setJoiningBrowser(true);
    try {
      const receipt = await acceptPolicy();
      await claimInviteInBrowser(code, receipt);
      window.location.assign("/channels");
    } catch (error) {
      setBrowserJoinError(
        error instanceof Error ? error.message : "Could not claim this invite.",
      );
    } finally {
      setJoiningBrowser(false);
    }
  };

  const handleGenerateIdentity = () => {
    const { nsec } = generateNewIdentity();
    setGenNsec(nsec);
    setGenKeySaved(false);
    setGenCopied(false);
    setIdMode("generate");
  };

  const handleCopyGenNsec = async () => {
    if (!genNsec) return;
    await navigator.clipboard.writeText(genNsec);
    setGenCopied(true);
    setTimeout(() => setGenCopied(false), 2000);
  };

  const handleConfirmGeneratedIdentity = () => {
    setIdentityReady(true);
    setShowIdentityStep(false);
    setIdMode("choose");
  };

  const handleNsecIdentity = (e: React.FormEvent) => {
    e.preventDefault();
    setIdentityError(null);
    try {
      loginWithNsec(nsecInput);
      setIdentityReady(true);
      setShowIdentityStep(false);
      setIdMode("choose");
    } catch (err) {
      setIdentityError(err instanceof Error ? err.message : "Invalid key.");
    }
  };

  const handleNip07Identity = async () => {
    setIdentityError(null);
    try {
      if (!window.nostr) throw new Error("No NIP-07 extension found.");
      await window.nostr.getPublicKey(); // confirms it's accessible
      setIdentityReady(true);
      setShowIdentityStep(false);
      setIdMode("choose");
    } catch (err) {
      setIdentityError(err instanceof Error ? err.message : "Extension login failed.");
    }
  };

  const browserSigningAvailable = true; // always show "Join in browser"; identity check happens on click
  const disabled =
    policy === undefined ||
    opening ||
    joiningBrowser ||
    Boolean(policy?.age_attestation_required && !ageConfirmed) ||
    Boolean(
      policy &&
        (policy.terms_markdown || policy.privacy_markdown) &&
        !agreementConfirmed,
    );
  const hasPolicyRequirements = Boolean(
    policy &&
      (policy.age_attestation_required ||
        policy.terms_markdown ||
        policy.privacy_markdown),
  );
  const showDocument = (title: string, markdown: string) =>
    setDocument({ title, markdown });
  const closeMacChoice = React.useCallback(() => {
    setShowMacChoice(false);
    window.setTimeout(() => downloadTriggerRef.current?.focus());
  }, []);
  const chooseMacDownload = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    platform: BuzzDownloadPlatform,
  ) => {
    event.preventDefault();
    if (choosingMacDownloadRef.current) return;
    choosingMacDownloadRef.current = true;
    setChoosingMacDownload(true);
    const downloadWindow = window.open("about:blank", "_blank");
    if (downloadWindow) downloadWindow.opener = null;
    setShowMacChoice(false);
    try {
      const url = await resolveBuzzDownloadUrlForPlatform(platform);
      downloadWindow?.location.replace(url);
    } finally {
      choosingMacDownloadRef.current = false;
      setChoosingMacDownload(false);
    }
  };

  React.useEffect(() => {
    if (!showMacChoice) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMacChoice();
    };
    window.document.addEventListener("keydown", closeOnEscape);
    return () => window.document.removeEventListener("keydown", closeOnEscape);
  }, [closeMacChoice, showMacChoice]);

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center"
      style={{
        backgroundImage: "linear-gradient(180deg, #D7D72E 0%, #D7E7F6 100%)",
      }}
    >
      <div className="w-full max-w-xl space-y-4">
        <div className="flex w-full flex-col items-center rounded-3xl bg-white px-6 py-10 sm:px-12 sm:py-12">
          <div
            className="h-12 w-12 overflow-hidden bg-black"
            style={{ borderRadius: "22.37%" }}
          >
            <img alt="Buzz" className="h-full w-full" src={buzzAppIcon} />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-black">
            You&apos;re invited to
          </h1>
          <p className="mt-9 font-mono text-lg text-black/70">{host}</p>

          <div
            className={`grid w-full max-w-md overflow-hidden transition-[grid-template-rows,margin,opacity,transform] duration-[220ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
              hasPolicyRequirements
                ? "mt-9 -mb-4 grid-rows-[1fr] opacity-100 translate-y-0"
                : "m-0 grid-rows-[0fr] opacity-0 -translate-y-1"
            }`}
          >
            <div className="min-h-0 overflow-hidden">
              {policy && hasPolicyRequirements ? (
                <InviteJoinPolicyNotice
                  ageConfirmed={ageConfirmed}
                  agreementConfirmed={agreementConfirmed}
                  onAgeConfirmedChange={setAgeConfirmed}
                  onAgreementConfirmedChange={setAgreementConfirmed}
                  onShowDocument={showDocument}
                  policy={policy}
                />
              ) : null}
            </div>
          </div>

          {/* Inline identity creation step */}
          {showIdentityStep && (
            <div className="mt-6 w-full max-w-md rounded-2xl border border-black/10 bg-[#FAFAFA] p-6 text-left">
              <p className="mb-4 text-sm font-semibold text-black">
                Choose your Nostr identity
              </p>

              {idMode === "choose" && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleGenerateIdentity}
                    className="flex w-full items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-black/5"
                  >
                    <Sparkles className="h-4 w-4 shrink-0 text-black/50" />
                    <div className="text-left">
                      <div className="font-medium">Generate a new identity</div>
                      <div className="text-xs font-normal text-black/50">New to Nostr — create a fresh keypair</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIdMode("nsec")}
                    className="flex w-full items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-black/5"
                  >
                    <KeyRound className="h-4 w-4 shrink-0 text-black/50" />
                    <div className="text-left">
                      <div className="font-medium">I already have a key</div>
                      <div className="text-xs font-normal text-black/50">Enter your nsec or hex secret key</div>
                    </div>
                  </button>
                  {hasNip07Provider() && (
                    <button
                      type="button"
                      onClick={handleNip07Identity}
                      className="flex w-full items-center gap-3 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-black transition-colors hover:bg-black/5"
                    >
                      <Puzzle className="h-4 w-4 shrink-0 text-black/50" />
                      <div className="text-left">
                        <div className="font-medium">Use browser extension</div>
                        <div className="text-xs font-normal text-black/50">Sign with your NIP-07 extension</div>
                      </div>
                    </button>
                  )}
                </div>
              )}

              {idMode === "generate" && genNsec && (
                <div className="space-y-3">
                  <p className="text-xs text-black/60">Your new secret key — save this before continuing:</p>
                  <div className="relative">
                    <input
                      readOnly
                      type="text"
                      value={genNsec}
                      className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 pr-10 font-mono text-xs text-black"
                    />
                    <button
                      type="button"
                      onClick={handleCopyGenNsec}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/70"
                      aria-label="Copy secret key"
                    >
                      {genCopied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <strong>Save this key before continuing.</strong> It's your password — there's no recovery if you lose it.
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-black/70">
                    <input
                      type="checkbox"
                      checked={genKeySaved}
                      onChange={(e) => setGenKeySaved(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-black/30 accent-black"
                    />
                    I've saved my secret key somewhere safe
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setIdMode("choose"); setGenNsec(null); }}
                      className="flex-1 rounded-lg border border-black/15 px-4 py-2 text-sm text-black/60 hover:bg-black/5"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmGeneratedIdentity}
                      disabled={!genKeySaved}
                      className="flex-1 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {idMode === "nsec" && (
                <form onSubmit={handleNsecIdentity} className="space-y-3">
                  <div className="relative">
                    <input
                      type={showNsecValue ? "text" : "password"}
                      value={nsecInput}
                      onChange={(e) => setNsecInput(e.target.value)}
                      placeholder="nsec1..."
                      autoComplete="off"
                      spellCheck={false}
                      className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 pr-10 text-sm text-black placeholder-black/30 outline-none focus:border-black/40"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNsecValue((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/70"
                    >
                      {showNsecValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {identityError && (
                    <p className="text-xs text-red-600">{identityError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => { setIdMode("choose"); setIdentityError(null); }}
                      className="flex-1 rounded-lg border border-black/15 px-4 py-2 text-sm text-black/60 hover:bg-black/5"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={!nsecInput.trim()}
                      className="flex-1 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Continue
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <div className="mt-9 w-full max-w-md space-y-2">
            {browserSigningAvailable ? (
              <Button
                className="h-10 w-full bg-black text-white hover:bg-black/90 focus-visible:ring-black disabled:cursor-not-allowed disabled:bg-black/30 disabled:text-white/70"
                disabled={disabled}
                onClick={joinInBrowser}
              >
                {joiningBrowser ? "Joining…" : identityReady ? "Join in browser" : "Join in browser"}
              </Button>
            ) : null}
            {policy === null ? (
              <Button
                asChild
                className={`h-10 w-full ${
                  browserSigningAvailable
                    ? "border border-black bg-white text-black hover:bg-black/5"
                    : "bg-black text-white hover:bg-black/90 focus-visible:ring-black"
                }`}
              >
                <a
                  href={`buzz://join?relay=${encodeURIComponent(relay)}&code=${encodeURIComponent(code)}`}
                >
                  Accept invite in Buzz
                </a>
              </Button>
            ) : (
              <Button
                className={`h-10 w-full disabled:cursor-not-allowed disabled:bg-black/30 disabled:text-white/70 ${
                  browserSigningAvailable
                    ? "border border-black bg-white text-black hover:bg-black/5"
                    : "bg-black text-white hover:bg-black/90 focus-visible:ring-black"
                }`}
                disabled={disabled}
                onClick={openInvite}
              >
                Accept invite in Buzz
              </Button>
            )}
            {browserJoinError ? (
              <p className="text-sm text-red-700" role="alert">
                {browserJoinError}
              </p>
            ) : null}
          </div>
        </div>
        <p className="flex h-[3.125rem] items-center justify-center rounded-2xl bg-white text-sm text-black/60">
          Don&apos;t have the app?{" "}
          <a
            aria-expanded={needsMacChoice ? showMacChoice : undefined}
            aria-haspopup={needsMacChoice ? "dialog" : undefined}
            className="ml-1 font-medium text-black underline-offset-4 hover:text-black/70 hover:underline focus-visible:underline"
            href={downloadUrl}
            ref={downloadTriggerRef}
            rel="noreferrer"
            target="_blank"
            onClick={(event) => {
              if (!needsMacChoice) return;
              event.preventDefault();
              setShowMacChoice(true);
            }}
          >
            Download it now
          </a>
        </p>
      </div>

      {showMacChoice && (
        <div
          aria-label="Which Mac do you have?"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 text-left"
          role="dialog"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeMacChoice();
          }}
        >
          <div className="w-full max-w-lg rounded-3xl bg-white p-7 text-black shadow-xl sm:p-9">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">
                  Which Mac do you have?
                </h2>
                <p className="mt-2 text-sm text-black/60">
                  Choose based on when your Mac was released.
                </p>
              </div>
              <button
                aria-label="Close"
                className="text-2xl leading-none text-black/60 hover:text-black"
                type="button"
                onClick={closeMacChoice}
              >
                ×
              </button>
            </div>
            <div className="mt-6 grid gap-3">
              <a
                aria-disabled={choosingMacDownload}
                className="rounded-2xl border border-black p-5 text-black no-underline hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black aria-disabled:pointer-events-none aria-disabled:opacity-50"
                href={BUZZ_RELEASES_URL}
                onClick={(event) =>
                  void chooseMacDownload(event, {
                    operatingSystem: "macos",
                    architecture: "arm64",
                  })
                }
              >
                <strong className="block text-lg">Newer Mac</strong>
                <span className="mt-1 block text-sm">
                  2021 or later, or a late-2020 Mac with an Apple M1 chip
                </span>
              </a>
              <a
                aria-disabled={choosingMacDownload}
                className="rounded-2xl border border-black p-5 text-black no-underline hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black aria-disabled:pointer-events-none aria-disabled:opacity-50"
                href={BUZZ_RELEASES_URL}
                onClick={(event) =>
                  void chooseMacDownload(event, {
                    operatingSystem: "macos",
                    architecture: "x64",
                  })
                }
              >
                <strong className="block text-lg">Older Mac</strong>
                <span className="mt-1 block text-sm">
                  2019 or earlier, or a 2020 Mac with an Intel processor
                </span>
              </a>
            </div>
            <p className="mt-5 text-sm leading-5">
              <strong>Not sure?</strong> Open the Apple menu and choose{" "}
              <strong>About This Mac</strong>. “Chip: Apple M…” means Newer Mac.
              “Processor: Intel” means Older Mac.
            </p>
          </div>
        </div>
      )}

      {document && (
        <div
          aria-label={document.title}
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 text-left"
          role="dialog"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDocument(null);
          }}
        >
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 text-black shadow-xl sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold">{document.title}</h2>
              <button
                aria-label="Close"
                className="text-2xl leading-none text-black/60 hover:text-black"
                type="button"
                onClick={() => setDocument(null)}
              >
                ×
              </button>
            </div>
            <div className="prose prose-sm max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>
                {document.markdown}
              </Markdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
