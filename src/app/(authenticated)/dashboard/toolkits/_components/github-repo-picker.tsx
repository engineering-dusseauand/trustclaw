"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, Lock, Plus, X } from "lucide-react";
import { trpc } from "~/clients/trpc";
import {
  showSuccessToast,
  showTrpcErrorToast,
} from "~/components/core/toast-notifications";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { MAX_PINNED_GITHUB_REPOS } from "~/server/api/routers/toolkits/setGithubPinnedRepos.schema";

interface GithubRepoPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const OWNER_REPO_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]+$/;

export function GithubRepoPicker({ open, onOpenChange }: GithubRepoPickerProps) {
  const utils = trpc.useUtils();

  const pinnedQuery = trpc.toolkits.getGithubPinnedRepos.useQuery(undefined, {
    enabled: open,
  });

  const reposQuery = trpc.toolkits.listGithubRepos.useQuery(
    { page: 1, perPage: 50 },
    { enabled: open, retry: false },
  );

  // Local working set, seeded from the server pin set on open.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [manualEntry, setManualEntry] = useState("");

  useEffect(() => {
    if (open && pinnedQuery.data) {
      setSelected(
        new Set(pinnedQuery.data.pinnedRepos.map((r: string) => r.toLowerCase())),
      );
    }
  }, [open, pinnedQuery.data]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setManualEntry("");
    }
  }, [open]);

  const setMutation = trpc.toolkits.setGithubPinnedRepos.useMutation({
    onSuccess: () => {
      void utils.toolkits.getGithubPinnedRepos.invalidate();
      showSuccessToast(
        selected.size === 0
          ? "GitHub repos unpinned"
          : `Pinned ${selected.size} repo${selected.size === 1 ? "" : "s"}`,
      );
      onOpenChange(false);
    },
    onError: showTrpcErrorToast,
  });

  const allRepos = reposQuery.data?.items ?? [];

  // Server-side rows the user already pinned that aren't in this page of
  // listGithubRepos — surface them at the top so they're not "lost".
  const pinnedNotInList = useMemo(() => {
    const visibleFullNames = new Set(allRepos.map((r) => r.fullName.toLowerCase()));
    return Array.from(selected).filter((r) => !visibleFullNames.has(r));
  }, [allRepos, selected]);

  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRepos;
    return allRepos.filter(
      (r) => r.fullName.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q),
    );
  }, [allRepos, search]);

  const toggle = (fullName: string) => {
    const lowered = fullName.toLowerCase();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lowered)) {
        next.delete(lowered);
      } else {
        if (next.size >= MAX_PINNED_GITHUB_REPOS) return prev;
        next.add(lowered);
      }
      return next;
    });
  };

  const handleManualAdd = () => {
    const v = manualEntry.trim();
    if (!OWNER_REPO_PATTERN.test(v)) return;
    const lowered = v.toLowerCase();
    setSelected((prev) => {
      if (prev.has(lowered)) return prev;
      if (prev.size >= MAX_PINNED_GITHUB_REPOS) return prev;
      const next = new Set(prev);
      next.add(lowered);
      return next;
    });
    setManualEntry("");
  };

  const handleSave = async () => {
    try {
      await setMutation.mutateAsync({ pinnedRepos: Array.from(selected) });
    } catch {
      // toast handled by onError
    }
  };

  const isLoading = pinnedQuery.isLoading || reposQuery.isLoading;
  const hasError = reposQuery.error;
  const canAddManual = OWNER_REPO_PATTERN.test(manualEntry.trim()) && selected.size < MAX_PINNED_GITHUB_REPOS;
  const isAtCap = selected.size >= MAX_PINNED_GITHUB_REPOS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[540px]"
      >
        <DialogHeader className="space-y-1 border-b px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-base">Pin GitHub repos</DialogTitle>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {selected.size} / {MAX_PINNED_GITHUB_REPOS}
            </span>
          </div>
          <DialogDescription className="text-sm">
            The agent can only operate on repos you pin here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 border-b px-6 py-3">
          <Input
            placeholder="Search your repos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={isLoading}
          />
          <div className="flex items-center gap-2">
            <Input
              placeholder="Add by name: owner/repo"
              value={manualEntry}
              onChange={(e) => setManualEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleManualAdd();
                }
              }}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualAdd}
              disabled={!canAddManual}
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : hasError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {reposQuery.error?.message ?? "Could not load GitHub repos."}
              </p>
              <Button size="sm" variant="outline" onClick={() => void reposQuery.refetch()}>
                Try again
              </Button>
            </div>
          ) : filteredRepos.length === 0 && pinnedNotInList.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search ? "No repos match your search." : "No repos found."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {pinnedNotInList.map((fullName) => (
                <Label
                  key={`manual-${fullName}`}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-accent/30 p-2.5"
                >
                  <Checkbox checked onCheckedChange={() => toggle(fullName)} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {fullName}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Added by name
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      toggle(fullName);
                    }}
                    className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </Label>
              ))}

              {filteredRepos.map((repo) => {
                const lowered = repo.fullName.toLowerCase();
                const isSelected = selected.has(lowered);
                const disabled = !isSelected && isAtCap;
                return (
                  <Label
                    key={`${repo.id}`}
                    htmlFor={`repo-${repo.id}`}
                    className={
                      "flex items-center gap-3 rounded-md border border-border p-2.5 transition-colors " +
                      (disabled
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer hover:bg-accent/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40")
                    }
                  >
                    <Checkbox
                      id={`repo-${repo.id}`}
                      checked={isSelected}
                      onCheckedChange={() => toggle(repo.fullName)}
                      disabled={disabled}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {repo.fullName}
                        </span>
                        {repo.private ? (
                          <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="private" />
                        ) : null}
                        {repo.archived ? (
                          <span className="rounded-sm bg-muted px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                            archived
                          </span>
                        ) : null}
                      </div>
                      {repo.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {repo.description}
                        </span>
                      ) : null}
                    </div>
                  </Label>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t px-6 py-3 sm:gap-2">
          <DialogClose asChild>
            <Button variant="outline" disabled={setMutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={setMutation.isPending}>
            {setMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Save pins
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
