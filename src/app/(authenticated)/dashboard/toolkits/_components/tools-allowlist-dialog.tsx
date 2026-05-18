"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { trpc } from "~/clients/trpc";
import {
  showSuccessToast,
  showTrpcErrorToast,
} from "~/components/core/toast-notifications";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
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
import { Switch } from "~/components/ui/switch";

interface ToolsAllowlistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Composio toolkit slug (lowercase, e.g. "github", "googlecalendar"). */
  toolkit: string;
  /** Display name for headers ("GitHub", "Google Calendar"). */
  toolkitName: string;
}

/**
 * Admin UI for editing the per-toolkit slice of `allowedToolSlugs`.
 *
 * The dialog loads the full Composio catalog for one toolkit (via
 * `getToolkitTools`) and lets the user toggle individual slugs. Saving
 * replaces only this toolkit's slice — other toolkits' slugs are
 * preserved server-side. The agent only ever sees enabled slugs because
 * `setup.ts` passes them into `ToolRouterCreateSessionConfig.tools`.
 *
 * Layout: category sections for curated slugs, plus an "Advanced"
 * collapsible for everything else (uncommon / dangerous tools that the
 * curated default deliberately omits).
 */
export function ToolsAllowlistDialog({
  open,
  onOpenChange,
  toolkit,
  toolkitName,
}: ToolsAllowlistDialogProps) {
  const utils = trpc.useUtils();

  const toolsQuery = trpc.toolkits.getToolkitTools.useQuery(
    { toolkit },
    { enabled: open, retry: false },
  );

  // Stabilise the items array reference across renders so downstream
  // memos don't recompute when only TanStack metadata (isFetching, etc.)
  // changes.
  const items = useMemo(
    () => toolsQuery.data?.items ?? [],
    [toolsQuery.data],
  );

  // Working set of enabled slugs (uppercase). Seeded once per open from
  // the server snapshot and mutated locally until the user clicks Save.
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Guards against re-seeding the working set mid-edit. Without this,
  // a stale-cache hit on reopen (e.g. right after Reset) could clobber
  // user toggles when the background refetch eventually arrives.
  const [seededForOpen, setSeededForOpen] = useState(false);

  useEffect(() => {
    if (
      open &&
      toolsQuery.data &&
      !toolsQuery.isFetching &&
      !seededForOpen
    ) {
      const initial = new Set<string>();
      let hasCuratedCategory = false;
      for (const item of toolsQuery.data.items) {
        if (item.isEnabled) initial.add(item.slug);
        if (item.category !== "Advanced") hasCuratedCategory = true;
      }
      setEnabled(initial);
      // For uncurated toolkits (no CATEGORIES export), every slug lands in
      // Advanced. Auto-expand so the user doesn't see an empty-looking
      // dialog with only a collapsed pile.
      if (!hasCuratedCategory) setAdvancedOpen(true);
      setSeededForOpen(true);
    }
  }, [open, toolsQuery.data, toolsQuery.isFetching, seededForOpen]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setAdvancedOpen(false);
      setSeededForOpen(false);
      // Flush the working set so the next open doesn't briefly show
      // the prior toolkit's count before its data lands.
      setEnabled(new Set());
    }
  }, [open]);

  const saveMutation = trpc.toolkits.setAllowedToolSlugs.useMutation({
    onSuccess: () => {
      void utils.toolkits.getToolkitTools.invalidate();
      showSuccessToast(
        `${toolkitName} tools updated: ${enabled.size} enabled`,
      );
      onOpenChange(false);
    },
    onError: showTrpcErrorToast,
  });

  const resetMutation = trpc.toolkits.resetToolkitToDefaults.useMutation({
    onSuccess: () => {
      void utils.toolkits.getToolkitTools.invalidate();
      showSuccessToast(`${toolkitName} reset to defaults`);
      onOpenChange(false);
    },
    onError: showTrpcErrorToast,
  });

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      return (
        item.slug.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        (item.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [items, search]);

  // Group filtered items by category. "Advanced" is special-cased — it
  // always goes last and is collapsed by default.
  const { categories, advanced } = useMemo(() => {
    const byCategory = new Map<string, typeof items>();
    let advancedItems: typeof items = [];
    for (const item of filteredItems) {
      if (item.category === "Advanced") {
        advancedItems = [...advancedItems, item];
        continue;
      }
      const existing = byCategory.get(item.category) ?? [];
      byCategory.set(item.category, [...existing, item]);
    }
    // Sort categories alphabetically for stable order across toolkits.
    const sorted = Array.from(byCategory.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return { categories: sorted, advanced: advancedItems };
  }, [filteredItems]);

  const totalEnabled = enabled.size;
  const totalAvailable = items.length;

  const toggle = (slug: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({
        toolkit,
        enabled: Array.from(enabled),
      });
    } catch {
      // toast handled by onError
    }
  };

  const handleReset = async () => {
    try {
      await resetMutation.mutateAsync({ toolkit });
    } catch {
      // toast handled by onError
    }
  };

  const isLoading = toolsQuery.isLoading;
  const hasError = toolsQuery.error;
  const isMutating = saveMutation.isPending || resetMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[600px]">
        <DialogHeader className="space-y-1 border-b px-6 py-4 text-left">
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="text-base">
              {toolkitName} tools
            </DialogTitle>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {totalEnabled} of {totalAvailable}
            </span>
          </div>
          <DialogDescription className="text-sm">
            The agent can only call tools you enable here. Curated defaults
            are pre-selected; everything else lives under Advanced.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b px-6 py-3">
          <Input
            placeholder="Search tools..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={isLoading || isMutating}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : hasError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground">
                {toolsQuery.error?.message ?? "Could not load tools."}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void toolsQuery.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : filteredItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {search
                ? "No tools match your search."
                : "No tools found for this toolkit."}
            </p>
          ) : (
            <div className="space-y-5">
              {categories.map(([category, catItems]) => (
                <section key={category}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {category}
                  </h3>
                  <div className="space-y-1.5">
                    {catItems.map((item) => (
                      <ToolRow
                        key={item.slug}
                        item={item}
                        isEnabled={enabled.has(item.slug)}
                        onToggle={() => toggle(item.slug)}
                        disabled={isMutating}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {advanced.length > 0 ? (
                <Collapsible
                  open={advancedOpen}
                  onOpenChange={setAdvancedOpen}
                >
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-muted/70"
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Advanced
                        </span>
                        <Badge variant="secondary" className="font-mono">
                          {advanced.length}
                        </Badge>
                      </span>
                      <ChevronDown
                        className={
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform " +
                          (advancedOpen ? "rotate-180" : "")
                        }
                      />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-1.5">
                    <p className="px-1 pb-1 text-xs text-muted-foreground">
                      Tools outside the curated default. Enable carefully —
                      destructive actions are marked.
                    </p>
                    {advanced.map((item) => (
                      <ToolRow
                        key={item.slug}
                        item={item}
                        isEnabled={enabled.has(item.slug)}
                        onToggle={() => toggle(item.slug)}
                        disabled={isMutating}
                      />
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 border-t px-6 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isMutating || isLoading || !!hasError}
            className="sm:mr-auto"
          >
            {resetMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Resetting...
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4" />
                Reset to defaults
              </>
            )}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-2">
            <DialogClose asChild>
              <Button variant="outline" disabled={isMutating}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleSave}
              disabled={isMutating || isLoading || !!hasError}
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Save changes
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ToolRowProps {
  item: {
    slug: string;
    label: string;
    description?: string;
    isDestructive: boolean;
    isInDefault: boolean;
  };
  isEnabled: boolean;
  onToggle: () => void;
  disabled: boolean;
}

function ToolRow({ item, isEnabled, onToggle, disabled }: ToolRowProps) {
  const rowId = `tool-${item.slug}`;
  return (
    <Label
      htmlFor={rowId}
      className={
        "flex cursor-pointer items-start gap-3 rounded-md border border-border p-2.5 transition-colors " +
        (disabled
          ? "cursor-not-allowed opacity-60"
          : "hover:bg-accent/50 has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-accent/30")
      }
    >
      <Switch
        id={rowId}
        checked={isEnabled}
        onCheckedChange={onToggle}
        disabled={disabled}
        className="mt-0.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">
            {item.label}
          </span>
          {item.isDestructive ? (
            <Badge
              variant="destructive"
              className="gap-1 font-normal"
              title="This tool can modify or delete data"
              aria-label="Destructive — this tool can modify or delete data"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              destructive
            </Badge>
          ) : null}
          {item.isInDefault ? (
            <Badge variant="outline" className="font-normal">
              default
            </Badge>
          ) : null}
        </div>
        <code className="font-mono text-[10px] text-muted-foreground">
          {item.slug}
        </code>
        {item.description ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {item.description}
          </p>
        ) : null}
      </div>
    </Label>
  );
}
