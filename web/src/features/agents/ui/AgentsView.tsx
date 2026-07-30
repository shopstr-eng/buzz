/**
 * Agents screen: personas, teams, managed agents, usage and live activity.
 *
 * - Directory: personas (30175), teams (30176), managed agents (30177) —
 *   create/edit/delete from the web (desktop-compatible snapshots) or from
 *   the desktop app; both stay in sync through the relay.
 * - Usage metrics (44200, NIP-AM): decrypted per-turn token/cost aggregates.
 * - Live activity (24200): observer frames folded into a transcript-style feed.
 */

import { useRef, useState } from "react";
import {
  Bot, Users, Cpu, Activity, MessageSquare, Wrench, CircleDollarSign,
  Plus, Pencil, Trash2, Upload, Brain, Globe, Share2,
} from "lucide-react";
import { useAgentDirectory, type AgentPersona, type AgentTeam } from "../use-agents";
import { useAgentActivity, type AgentActivityItem } from "../use-agent-frames";
import { useAgentMetrics, type AgentMetricAggregate } from "../use-agent-metrics";
import { useAgentPublishing } from "../use-agent-publishing";
import { personaToFormInput } from "../agent-events";
import { parseSnapshot, snapshotToPersonaInput } from "../lib/agent-snapshot";
import { useEngrams } from "../use-engrams";
import { MemorySection } from "./MemorySection";
import { useAgentCatalog } from "../use-agent-catalog";
import { catalogToPersonaInput, type CatalogPersona } from "../lib/agent-catalog";
import { CatalogSection } from "./CatalogSection";
import { PersonaDialog } from "./PersonaDialog";
import { PersonaShareDialog } from "./PersonaShareDialog";
import { TeamDialog } from "./TeamDialog";
import { ManagedAgentDialog } from "./ManagedAgentDialog";
import { truncatePubkey } from "@/shared/lib/pubkey";

type DialogState =
  | { type: "persona"; existing: AgentPersona | null }
  | { type: "personaShare"; personaId: string }
  | { type: "team"; existing: AgentTeam | null }
  | { type: "agent" }
  | null;

const iconBtnCls =
  "rounded p-1 text-black/30 hover:bg-black/5 hover:text-black/60 dark:text-white/30 dark:hover:bg-white/10 dark:hover:text-white/60";

function PersonaCard({
  persona,
  onEdit,
  onDelete,
  onShare,
}: {
  persona: AgentPersona;
  onEdit: () => void;
  onDelete: () => void;
  onShare: () => void;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-[#1A1A1A]">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-black dark:text-white">
            {persona.displayName}
            {persona.shared && (
              <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                shared
              </span>
            )}
          </p>
          <p className="truncate text-[11px] text-black/40 dark:text-white/40">
            {[persona.runtime, persona.model, persona.provider]
              .filter(Boolean)
              .join(" · ") || "No runtime configured"}
          </p>
        </div>
        <button
          className={iconBtnCls}
          onClick={onShare}
          aria-label={`Share ${persona.displayName}`}
          title="Share — catalog, memory levels, export"
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtnCls} onClick={onEdit} aria-label={`Edit ${persona.displayName}`}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button className={iconBtnCls} onClick={onDelete} aria-label={`Delete ${persona.displayName}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {persona.systemPrompt && (
        <p className="mt-2 line-clamp-2 text-[11px] text-black/50 dark:text-white/50">
          {persona.systemPrompt}
        </p>
      )}
    </div>
  );
}

function MetricRow({ metric }: { metric: AgentMetricAggregate }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-black/8 px-3 py-2 dark:border-white/8">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-black dark:text-white">
          {truncatePubkey(metric.agentPubkey)}
          {metric.model && (
            <span className="ml-1.5 text-black/40 dark:text-white/40">{metric.model}</span>
          )}
        </p>
        <p className="text-[10px] text-black/35 dark:text-white/35">
          {metric.turns} turn{metric.turns === 1 ? "" : "s"} ·{" "}
          {(metric.totalTokens > 0
            ? metric.totalTokens
            : metric.inputTokens + metric.outputTokens
          ).toLocaleString()}{" "}
          tokens
        </p>
      </div>
      {metric.costUsd > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
          <CircleDollarSign className="h-3.5 w-3.5" />
          ${metric.costUsd.toFixed(4)}
        </span>
      )}
    </div>
  );
}

const ACTIVITY_ICON: Record<string, typeof MessageSquare> = {
  prompt: MessageSquare,
  message: Bot,
  tool_call: Wrench,
  turn_started: Activity,
  turn_ended: Activity,
  status: Activity,
};

function ActivityRow({ item }: { item: AgentActivityItem }) {
  const Icon = ACTIVITY_ICON[item.kind] ?? Activity;
  const time = new Date(item.at * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5">
      <div
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          item.kind === "prompt"
            ? "bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300"
            : item.kind === "message"
              ? "bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"
              : "bg-black/5 text-black/40 dark:bg-white/10 dark:text-white/40"
        }`}
      >
        <Icon className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-xs text-black/80 dark:text-white/80 line-clamp-4">
          {item.text}
        </p>
        <p className="mt-0.5 text-[10px] text-black/35 dark:text-white/35">
          {item.kind.replace("_", " ")} · {truncatePubkey(item.agentPubkey)} · {time}
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  Icon,
  count,
  action,
  children,
  empty,
}: {
  title: string;
  Icon: typeof Bot;
  count?: number;
  action?: React.ReactNode;
  children?: React.ReactNode;
  empty?: string;
}) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
          <Icon className="h-3.5 w-3.5" />
          {title}
          {count !== undefined && <span className="text-black/30 dark:text-white/30">({count})</span>}
        </h2>
        {action}
      </div>
      {children ?? (
        <p className="rounded-lg border border-dashed border-black/15 px-3 py-4 text-center text-xs text-black/40 dark:border-white/15 dark:text-white/40">
          {empty}
        </p>
      )}
    </section>
  );
}

function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-lg border border-black/15 px-2 py-1 text-[11px] font-medium text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
    >
      <Plus className="h-3 w-3" />
      {label}
    </button>
  );
}

export function AgentsView() {
  const { personas, teams, agents, isLoading: dirLoading } = useAgentDirectory();
  const { metrics, decryptUnavailable } = useAgentMetrics();
  const { items: activity, isLoading: activityLoading } = useAgentActivity();
  const { byAgent: memoryByAgent, isLoading: memoryLoading } = useEngrams();
  const memoryTotal = [...memoryByAgent.values()].reduce(
    (n, g) => n + g.reachable.size + g.orphans.length,
    0,
  );
  const agentNames = new Map(
    agents.filter((a) => a.name).map((a) => [a.pubkey, a.name as string]),
  );
  const {
    entries: catalogEntries,
    copied: catalogCopied,
    markCopied,
    isLoading: catalogLoading,
  } = useAgentCatalog();
  const [addingCatalogId, setAddingCatalogId] = useState<string | null>(null);

  /** Copy a shared catalog persona into the owner's private list (fresh slug). */
  async function handleAddCatalog(entry: CatalogPersona): Promise<void> {
    setAddingCatalogId(entry.coordinate);
    try {
      await savePersona(catalogToPersonaInput(entry), null, personas.map((p) => p.id));
      markCopied(entry.coordinate);
    } catch {
      // surfaced via publishError
    } finally {
      setAddingCatalogId(null);
    }
  }
  const { savePersona, deletePersona, deleteTeam, deleteManagedAgent, isPublishing, error: publishError } = useAgentPublishing();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function confirmDelete(label: string, action: () => Promise<void>) {
    if (window.confirm(`Delete ${label}? This publishes a deletion event and cannot be undone.`)) {
      action().catch(() => {/* surfaced via publishError */});
    }
  }

  /**
   * Flip a persona's catalog-shared flag by republishing its full record with
   * the shared tag toggled — same kind:30175 write contract as an edit, so
   * all desktop-contract fields (namePool, parallelism, allowlist) survive.
   */
  async function handleCatalogSharedChange(persona: AgentPersona, shared: boolean): Promise<void> {
    try {
      await savePersona(
        personaToFormInput(persona, shared),
        persona.id,
        personas.map((p) => p.id),
      );
    } catch {
      // surfaced via publishError (passed into the share dialog)
    }
  }

  /**
   * Import a snapshot as a NEW persona (fresh slug — imports never overwrite
   * an existing persona, matching the desktop's always-mint rule).
   */
  async function handleImportFile(file: File): Promise<void> {
    setImportError(null);
    const parsed = parseSnapshot(await file.text());
    if (!parsed.ok) {
      setImportError(parsed.error);
      return;
    }
    try {
      await savePersona(
        snapshotToPersonaInput(parsed.snapshot),
        null,
        personas.map((p) => p.id),
      );
    } catch {
      // surfaced via publishError
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-lg font-bold text-black dark:text-white">Agents</h1>
      <p className="mb-6 text-xs text-black/40 dark:text-white/40">
        Personas, teams, usage and live agent activity. Create and manage them
        here or from the desktop app — both stay in sync.
      </p>
      {publishError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {publishError}
        </p>
      )}
      {importError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          Snapshot import failed: {importError}
        </p>
      )}

      <Section title="Personas" Icon={Bot} count={personas.length}
        action={
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleImportFile(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 rounded-lg border border-black/15 px-2 py-1 text-[11px] font-medium text-black/60 hover:bg-black/5 dark:border-white/15 dark:text-white/60 dark:hover:bg-white/10"
            >
              <Upload className="h-3 w-3" />
              Import
            </button>
            <NewButton label="New persona" onClick={() => setDialog({ type: "persona", existing: null })} />
          </div>
        }
        empty={dirLoading ? "Loading…" : "No personas yet — create your first one."}>
        {personas.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {personas.map((p) => (
              <PersonaCard
                key={p.id}
                persona={p}
                onEdit={() => setDialog({ type: "persona", existing: p })}
                onDelete={() => confirmDelete(`persona "${p.displayName}"`, () => deletePersona(p.id))}
                onShare={() => setDialog({ type: "personaShare", personaId: p.id })}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Community catalog" Icon={Globe} count={catalogEntries.length}
        empty={catalogLoading
          ? "Loading shared agents…"
          : "No shared agents yet. Personas members share to the catalog appear here."}>
        {catalogEntries.length > 0 && (
          <CatalogSection
            entries={catalogEntries}
            copied={catalogCopied}
            addingId={addingCatalogId}
            onAdd={(e) => void handleAddCatalog(e)}
          />
        )}
      </Section>

      <Section title="Teams" Icon={Users} count={teams.length}
        action={<NewButton label="New team" onClick={() => setDialog({ type: "team", existing: null })} />}
        empty={dirLoading ? "Loading…" : "No teams yet — group personas into one."}>
        {teams.length > 0 && (
          <div className="space-y-2">
            {teams.map((t) => (
              <div key={t.id} className="flex items-start justify-between gap-2 rounded-lg border border-black/8 px-3 py-2 dark:border-white/8">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-black dark:text-white">
                    {t.name}
                    {t.version && (
                      <span className="ml-1.5 text-[10px] text-black/35 dark:text-white/35">v{t.version}</span>
                    )}
                  </p>
                  {t.description && (
                    <p className="text-[11px] text-black/45 dark:text-white/45">{t.description}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-black/35 dark:text-white/35">
                    {t.personaIds.length} persona{t.personaIds.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex shrink-0">
                  <button className={iconBtnCls} onClick={() => setDialog({ type: "team", existing: t })} aria-label={`Edit ${t.name}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button className={iconBtnCls} onClick={() => confirmDelete(`team "${t.name}"`, () => deleteTeam(t.id))} aria-label={`Delete ${t.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Managed agents" Icon={Cpu} count={agents.length}
        action={<NewButton label="New agent" onClick={() => setDialog({ type: "agent" })} />}
        empty={dirLoading ? "Loading…" : "No managed agents yet — create one to get an agent key."}>
        {agents.length > 0 && (
          <div className="space-y-2">
            {agents.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-black/8 px-3 py-2 dark:border-white/8">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-black dark:text-white">
                    {a.name ?? truncatePubkey(a.pubkey)}
                  </p>
                  {a.personaId && (
                    <p className="text-[10px] text-black/35 dark:text-white/35">persona: {a.personaId}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center">
                  {a.status && (
                    <span className="mr-1 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                      {a.status}
                    </span>
                  )}
                  <button
                    className={iconBtnCls}
                    onClick={() => confirmDelete(`agent "${a.name ?? truncatePubkey(a.pubkey)}"`, () => deleteManagedAgent(a.id))}
                    aria-label={`Delete ${a.name ?? "agent"}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Usage" Icon={CircleDollarSign} count={metrics.length}
        empty={
          decryptUnavailable
            ? "Metrics exist but can't be decrypted without your secret key."
            : "No turn metrics yet. Metrics appear after agents complete turns."
        }>
        {metrics.length > 0 && (
          <div className="space-y-1.5">
            {metrics.map((m) => (
              <MetricRow key={`${m.agentPubkey}:${m.model ?? ""}`} metric={m} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Live activity" Icon={Activity} count={activity.length}
        empty={activityLoading ? "Listening for agent frames…" : "No recent agent activity."}>
        {activity.length > 0 && (
          <div className="divide-y divide-black/5 rounded-lg border border-black/8 px-2 dark:divide-white/5 dark:border-white/8">
            {activity.map((item) => <ActivityRow key={item.id} item={item} />)}
          </div>
        )}
      </Section>

      <Section title="Memory" Icon={Brain} count={memoryTotal}
        empty={memoryLoading
          ? "Decrypting engrams…"
          : "No agent memories yet. Engrams appear as agents record what they learn."}>
        {memoryTotal > 0 && (
          <MemorySection byAgent={memoryByAgent} agentNames={agentNames} />
        )}
      </Section>

      {dialog?.type === "personaShare" && (() => {
        // Resolve the live persona each render so the catalog toggle reflects
        // the relay echo after a shared flip; close if it was deleted.
        const persona = personas.find((p) => p.id === dialog.personaId);
        if (!persona) return null;
        const linkedAgent = agents.find((a) => a.personaId === persona.id);
        return (
          <PersonaShareDialog
            persona={persona}
            memoryGraph={linkedAgent ? (memoryByAgent.get(linkedAgent.pubkey) ?? null) : null}
            isPublishing={isPublishing}
            publishError={publishError}
            onCatalogSharedChange={(shared) => void handleCatalogSharedChange(persona, shared)}
            onClose={() => setDialog(null)}
          />
        );
      })()}
      {dialog?.type === "persona" && (
        <PersonaDialog
          existing={dialog.existing}
          takenSlugs={personas.map((p) => p.id).filter((id) => id !== dialog.existing?.id)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "team" && (
        <TeamDialog
          existing={dialog.existing}
          personas={personas}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === "agent" && (
        <ManagedAgentDialog personas={personas} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
