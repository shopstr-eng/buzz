/**
 * Memory section content: per-agent engram graphs (core-rooted reachability
 * tree, orphan slugs, dangling refs). Pure render — useEngrams lives in
 * AgentsView so Section count/empty states stay accurate.
 */

import { Bot } from "lucide-react";
import type { MemoryGraph } from "../lib/engrams";
import { truncatePubkey } from "@/shared/lib/pubkey";

const MAX_DEPTH = 6;

function MemoryTree({
  graph,
  slug,
  depth,
  path,
}: {
  graph: MemoryGraph;
  slug: string;
  depth: number;
  path: ReadonlySet<string>;
}) {
  const node = graph.reachable.get(slug);
  if (!node || depth > MAX_DEPTH) return null;
  const nextPath = new Set(path);
  nextPath.add(slug);
  const children = node.refs.filter((r) => graph.reachable.has(r) && !nextPath.has(r));
  return (
    <div className={depth > 0 ? "ml-2 border-l border-black/10 pl-2 dark:border-white/10" : ""}>
      <p className="font-mono text-[10px] font-medium text-violet-600 dark:text-violet-300">
        {node.slug}
      </p>
      <p className="line-clamp-3 whitespace-pre-wrap text-[11px] text-black/55 dark:text-white/55">
        {node.text}
      </p>
      {children.map((r) => (
        <MemoryTree key={r} graph={graph} slug={r} depth={depth + 1} path={nextPath} />
      ))}
    </div>
  );
}

export function MemorySection({
  byAgent,
  agentNames,
}: {
  byAgent: Map<string, MemoryGraph>;
  agentNames?: Map<string, string>;
}) {
  return (
    <div className="space-y-3">
      {[...byAgent.entries()].map(([agent, graph]) => {
        const total = graph.reachable.size + graph.orphans.length;
        return (
          <div
            key={agent}
            className="rounded-lg border border-black/8 px-3 py-2 dark:border-white/8"
          >
            <p className="flex items-center gap-1.5 text-xs font-semibold text-black dark:text-white">
              <Bot className="h-3.5 w-3.5 shrink-0 text-violet-500" />
              <span className="truncate">{agentNames?.get(agent) ?? truncatePubkey(agent)}</span>
              <span className="ml-auto shrink-0 text-[10px] font-normal text-black/35 dark:text-white/35">
                {total} {total === 1 ? "memory" : "memories"}
              </span>
            </p>
            <div className="mt-1.5">
              {graph.core ? (
                <MemoryTree graph={graph} slug="core" depth={0} path={new Set()} />
              ) : (
                <p className="text-[11px] italic text-black/35 dark:text-white/35">
                  No core profile.
                </p>
              )}
            </div>
            {graph.orphans.length > 0 && (
              <p className="mt-1.5 text-[10px] text-black/40 dark:text-white/40">
                Orphans:{" "}
                {graph.orphans.map((n) => (
                  <span
                    key={n.slug}
                    className="mr-1 inline-block rounded bg-black/5 px-1 font-mono dark:bg-white/10"
                  >
                    {n.slug}
                  </span>
                ))}
              </p>
            )}
            {graph.danglingRefs.length > 0 && (
              <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                Dangling refs: {graph.danglingRefs.join(", ")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
