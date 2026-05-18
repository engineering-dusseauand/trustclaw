"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { trpc } from "~/clients/trpc";
import {
  showSuccessToast,
  showTrpcErrorToast,
} from "~/components/core/toast-notifications";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";

interface SupabaseProjectPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SupabaseProjectPicker({
  open,
  onOpenChange,
}: SupabaseProjectPickerProps) {
  const utils = trpc.useUtils();

  const pinnedQuery = trpc.toolkits.getSupabaseProjectRef.useQuery(undefined, {
    enabled: open,
  });

  const projectsQuery = trpc.toolkits.listSupabaseProjects.useQuery(undefined, {
    enabled: open,
    retry: false,
  });

  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (open && pinnedQuery.data) {
      setSelected(pinnedQuery.data.projectRef);
    }
  }, [open, pinnedQuery.data]);

  const setRef = trpc.toolkits.setSupabaseProjectRef.useMutation({
    onSuccess: () => {
      void utils.toolkits.getSupabaseProjectRef.invalidate();
      showSuccessToast("Supabase project pinned");
      onOpenChange(false);
    },
    onError: showTrpcErrorToast,
  });

  const handleSave = async () => {
    if (!selected) return;
    try {
      await setRef.mutateAsync({ projectRef: selected });
    } catch {
      // toast already shown by onError
    }
  };

  const items = projectsQuery.data?.items ?? [];
  const isLoading = pinnedQuery.isLoading || projectsQuery.isLoading;
  const hasError = projectsQuery.error;
  const isEmpty = !isLoading && !hasError && items.length === 0;
  const canSave =
    !!selected &&
    selected !== pinnedQuery.data?.projectRef &&
    !setRef.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Pin Supabase project</DialogTitle>
          <DialogDescription>
            The agent can only operate on the project you pin here.
            Supabase&apos;s Management API tokens are org-scoped, so this is
            the only way to keep the agent out of your other projects.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
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
                {projectsQuery.error?.message ??
                  "Could not load Supabase projects."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void projectsQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : isEmpty ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No Supabase projects found for this account.
            </p>
          ) : (
            <RadioGroup
              value={selected ?? ""}
              onValueChange={(v) => setSelected(v)}
              className="max-h-[320px] gap-2 overflow-y-auto pr-1"
            >
              {items.map((project) => {
                const isCurrent =
                  pinnedQuery.data?.projectRef === project.id;
                return (
                  <Label
                    key={project.id}
                    htmlFor={`project-${project.id}`}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:bg-accent/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent/40"
                  >
                    <RadioGroupItem
                      id={`project-${project.id}`}
                      value={project.id}
                      className="mt-0.5"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </span>
                        {isCurrent ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-1.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" />
                            Pinned
                          </span>
                        ) : null}
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {project.id}
                        {project.region ? ` · ${project.region}` : ""}
                        {project.status ? ` · ${project.status}` : ""}
                      </span>
                    </div>
                  </Label>
                );
              })}
            </RadioGroup>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={setRef.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={!canSave}>
            {setRef.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
