/**
 * Sub-directory tree browsing page for a repository.
 *
 * Route: /repos/$repoId/tree/src/components  (_splat = "src/components")
 *
 * Renders:
 *  - Breadcrumb trail back to root and intermediate directories
 *  - Tree listing for the current directory via useGitTree(path)
 */

import { ArrowLeft, BookMarked, ChevronRight, Folder } from "lucide-react";
import { Link, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { useEffect } from "react";
import { useRepoContext } from "../use-repo-context";
import { useGitTree } from "../use-git-browse";
import { getMockSubTree } from "../mock-repos";
import { RepoTreeSection } from "./RepoTreeSection";

/** Build breadcrumb segments from a slash-delimited path string. */
function pathSegments(dirPath: string): Array<{ label: string; path: string }> {
  const parts = dirPath.split("/").filter(Boolean);
  return parts.map((label, i) => ({
    label,
    path: parts.slice(0, i + 1).join("/"),
  }));
}

function SubTreeSkeleton() {
  return (
    <div className="flex w-full flex-1 bg-[#F3F3F3] px-4 py-8 dark:bg-[#171717]">
      <div className="min-w-0 flex-1">
        <div className="h-5 w-40 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="mt-6 h-5 w-56 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        <div className="mt-8 space-y-3">
          {["s1", "s2", "s3"].map((k) => (
            <div
              key={k}
              className="h-9 w-full animate-pulse rounded bg-black/10 dark:bg-white/10"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function RepoSubTreePage() {
  const { repoId: repoIdParam, _splat } = useParams({
    from: "/repos/$repoId/tree/$",
  });
  const repoId = repoIdParam ?? "";
  const dirPath = _splat ?? "";

  const preview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") ===
      "repositories";

  const { owner, repoName, defaultRef, isLoading, error } = useRepoContext(
    repoId,
    { preview },
  );

  const browseOwner = preview ? "" : owner;

  const {
    data: fetchedEntries,
    isLoading: treeLoading,
    error: treeError,
  } = useGitTree(browseOwner, repoName, defaultRef, dirPath);

  const mockEntries = preview ? getMockSubTree(dirPath) : undefined;
  const entries = preview ? mockEntries ?? undefined : fetchedEntries;
  const entriesLoading = preview ? false : treeLoading;

  useEffect(() => {
    if (treeError) {
      console.error("[git-browse] subtree", treeError);
    }
  }, [treeError]);

  useEffect(() => {
    if (error) {
      toast.error("Failed to load repository", { description: error.message });
    }
  }, [error]);

  if (isLoading) return <SubTreeSkeleton />;

  const segments = pathSegments(dirPath);

  return (
    <div className="flex w-full flex-1 bg-[#F3F3F3] px-4 py-8 text-black dark:bg-[#171717] dark:text-white">
      <div className="min-w-0 flex-1">
        {/* Back to repo root */}
        <Link
          to="/repos/$repoId"
          params={{ repoId }}
          search={preview ? ({ preview: "repositories" } as Record<string, string>) : undefined}
          className="inline-flex items-center gap-1 text-sm text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to repository
        </Link>

        {/* Breadcrumb */}
        <nav
          aria-label="Directory path"
          className="mt-5 flex flex-wrap items-center gap-1 text-sm"
        >
          {/* Root */}
          <Link
            to="/repos/$repoId"
            params={{ repoId }}
            search={preview ? ({ preview: "repositories" } as Record<string, string>) : undefined}
            className="flex items-center gap-1 text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
          >
            <BookMarked className="h-3.5 w-3.5" />
            <span>root</span>
          </Link>

          {segments.map(({ label, path }, i) => {
            const isLast = i === segments.length - 1;
            return (
              <span key={path} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-black/30 dark:text-white/30" />
                {isLast ? (
                  <span className="flex items-center gap-1 font-medium text-black dark:text-white">
                    <Folder className="h-3.5 w-3.5" />
                    {label}
                  </span>
                ) : (
                  <Link
                    to="/repos/$repoId/tree/$"
                    params={{ repoId, _splat: path }}
                    search={preview ? ({ preview: "repositories" } as Record<string, string>) : undefined}
                    className="flex items-center gap-1 text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white"
                  >
                    <Folder className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>

        {/* Browse error banner */}
        {treeError && (
          <div className="mt-6 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Failed to load directory:{" "}
            {treeError instanceof Error
              ? treeError.message
              : String(treeError)}
          </div>
        )}

        {/* Tree listing */}
        <RepoTreeSection
          entries={entries}
          isLoading={entriesLoading}
          repoId={repoId}
          currentPath={dirPath}
          preview={preview}
        />

        {/* Empty state */}
        {!entriesLoading && entries?.length === 0 && (
          <div className="mt-8 rounded-lg border border-black/10 px-4 py-8 text-center dark:border-white/10">
            <p className="text-sm text-black/50 dark:text-white/50">
              This directory is empty.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
