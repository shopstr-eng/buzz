/**
 * Agents screen: the relay-readable slice of the desktop's agents surface.
 *
 * - Directory: personas (30175), teams (30176), managed agents (30177) —
 *   read-only owner snapshots published by the backend.
 * - Usage metrics (44200, NIP-AM): decrypted per-turn token/cost aggregates.
 * - Live activity (24200): observer frames folded into a transcript-style feed.
 *
 * Persona/team creation stays in the desktop app / admin console.
 */

import { Bot, Users, Cpu, Activity, MessageSquare, Wrench, CircleDollarSign } from "lucide-react";
import { useAgentDirectory, type AgentPersona } from "../use-agents";
import { useAgentActivity, type AgentActivityItem } from "../use-agent-frames";
import { useAgentMetrics, type AgentMetricAggregate } from "../use-agent-metrics";
import { truncatePubkey } from "@/shared/lib/pubkey";

function PersonaCard({ persona }: { persona: AgentPersona }) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-[#1A1A1A]">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-black dark:text-white">
            {persona.displayName}
          </p>
          <p className="truncate text-[11px] text-black/40 dark:text-white/40">
            {[persona.runtime, persona.model, persona.provider]
              .filter(Boolean)
              .join(" · ") || "No runtime configured"}
          </p>
        </div>
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
          {(metric.inputTokens + metric.outputTokens).toLocaleString()} tokens
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
  children,
  empty,
}: {
  title: string;
  Icon: typeof Bot;
  count?: number;
  children?: React.ReactNode;
  empty?: string;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">
        <Icon className="h-3.5 w-3.5" />
        {title}
        {count !== undefined && <span className="text-black/30 dark:text-white/30">({count})</span>}
      </h2>
      {children ?? (
        <p className="rounded-lg border border-dashed border-black/15 px-3 py-4 text-center text-xs text-black/40 dark:border-white/15 dark:text-white/40">
          {empty}
        </p>
      )}
    </section>
  );
}

export function AgentsView() {
  const { personas, teams, agents, isLoading: dirLoading } = useAgentDirectory();
  const { metrics, decryptUnavailable } = useAgentMetrics();
  const { items: activity, isLoading: activityLoading } = useAgentActivity();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="mb-1 text-lg font-bold text-black dark:text-white">Agents</h1>
      <p className="mb-6 text-xs text-black/40 dark:text-white/40">
        Personas, teams, usage and live agent activity. Manage personas and
        deployments from the desktop app or admin console.
      </p>

      <Section title="Personas" Icon={Bot} count={personas.length}
        empty={dirLoading ? "Loading…" : "No personas published yet."}>
        {personas.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {personas.map((p) => <PersonaCard key={p.id} persona={p} />)}
          </div>
        )}
      </Section>

      <Section title="Teams" Icon={Users} count={teams.length}
        empty={dirLoading ? "Loading…" : "No teams published yet."}>
        {teams.length > 0 && (
          <div className="space-y-2">
            {teams.map((t) => (
              <div key={t.id} className="rounded-lg border border-black/8 px-3 py-2 dark:border-white/8">
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
            ))}
          </div>
        )}
      </Section>

      <Section title="Managed agents" Icon={Cpu} count={agents.length}
        empty={dirLoading ? "Loading…" : "No managed agents published yet."}>
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
                {a.status && (
                  <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-black/60 dark:bg-white/10 dark:text-white/60">
                    {a.status}
                  </span>
                )}
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
    </div>
  );
}
