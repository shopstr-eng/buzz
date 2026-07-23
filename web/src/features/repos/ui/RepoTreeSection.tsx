import { File, Folder } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { TreeEntry } from "../git-client";

function TreeRow({
  entry,
  repoId,
  currentPath,
  preview,
}: {
  entry: TreeEntry;
  repoId: string;
  currentPath: string;
  preview: boolean;
}) {
  const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;

  if (entry.type === "tree") {
    return (
      <Link
        to="/repos/$repoId/tree/$"
        params={{ repoId, _splat: entryPath }}
        search={preview ? ({ preview: "repositories" } as Record<string, string>) : undefined}
        className="flex items-center gap-2 border-b border-black/10 px-3 py-2 text-sm text-black last:border-b-0 hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/5"
      >
        <Folder className="h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
        <span className="font-medium">{entry.name}</span>
      </Link>
    );
  }

  return (
    <Link
      to="/repos/$repoId/blob/$"
      params={{ repoId, _splat: entryPath }}
      search={preview ? ({ preview: "repositories" } as Record<string, string>) : undefined}
      className="flex items-center gap-2 border-b border-black/10 px-3 py-2 text-sm text-black last:border-b-0 hover:bg-black/5 dark:border-white/10 dark:text-white dark:hover:bg-white/5"
    >
      <File className="h-4 w-4 shrink-0 text-black/50 dark:text-white/50" />
      <span>{entry.name}</span>
    </Link>
  );
}

export function RepoTreeSection({
  entries,
  isLoading,
  repoId,
  currentPath = "",
  preview = false,
}: {
  entries: TreeEntry[] | undefined;
  isLoading: boolean;
  repoId: string;
  /** Current directory path relative to repo root (empty string = root). */
  currentPath?: string;
  preview?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="mt-8">
        <div className="rounded-lg border border-black/10 dark:border-white/10">
          {["sk-1", "sk-2", "sk-3", "sk-4", "sk-5"].map((key) => (
            <div
              key={key}
              className="flex items-center gap-2 border-b border-black/10 px-3 py-2 last:border-b-0 dark:border-white/10"
            >
              <div className="h-4 w-4 animate-pulse rounded bg-black/10 dark:bg-white/10" />
              <div className="h-4 w-32 animate-pulse rounded bg-black/10 dark:bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!entries || entries.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="overflow-hidden rounded-lg border border-black/10 bg-white/50 dark:border-white/10 dark:bg-white/5">
        {entries.map((entry) => (
          <TreeRow
            key={entry.name}
            entry={entry}
            repoId={repoId}
            currentPath={currentPath}
            preview={preview}
          />
        ))}
      </div>
    </div>
  );
}
