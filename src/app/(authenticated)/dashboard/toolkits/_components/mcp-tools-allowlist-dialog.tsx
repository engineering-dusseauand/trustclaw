"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";

interface McpToolsAllowlistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** MCP server row id (cuid). */
  serverId: string;
  /** Display name for the dialog header. */
  serverName: string;
}

/**
 * Per-MCP-server tool allowlist dialog. Mirrors the UX of
 * `tools-allowlist-dialog.tsx` (the Composio version) but works against
 * arbitrary remote MCP servers whose tool catalogs are not curated —
 * there are no categories or destructive flags, so the layout is a flat
 * searchable list rather than category sections.
 *
 * Forked rather than parameterized: the Composio dialog has qa-expert
 * fixes baked into its stale-cache + state-flush logic, and the data
 * shape (slug+category+isDestructive vs name) is different enough that
 * a polymorphic version would bury the actual control flow under
 * conditional branching.
 */
export function McpToolsAllowlistDialog({
  open,
  onOpenChange,
  serverId,
  serverName,
}: McpToolsAllowlistDialogProps) {
  const utils = trpc.useUtils();

  const toolsQuery = trpc.mcp.getMcpServerTools.useQuery(
    { id: serverId },
    { enabled: open, retry: false },
  );

  const items = useMemo(
    () => toolsQuery.data?.items ?? [],
    [toolsQuery.data],
  );

  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [seededForOpen, setSeededForOpen] = useState(false);

  // Seed the working set once per open, after fresh data lands. This
  // mirrors the stale-cache guard from the Composio dialog (qa-expert
  // finding: quick close-reopen could clobber user toggles).
  useEffect(() => {
    if (open && toolsQuery.data && !toolsQuery.isFetching && !seededForOpen) {
      const initial = new Set<string>();
      for (const item of toolsQuery.data.items) {
        if (item.isEnabled) initial.add(item.name);
      }
      setEnabled(initial);
      setSeededForOpen(true);
    }
  }, [open, toolsQuery.data, toolsQuery.isFetching, seededForOpen]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setSeededForOpen(false);
      setEnabled(new Set());
    }
  }, [open]);

  const saveMutation = trpc.mcp.setMcpServerAllowedTools.useMutation({
    onSuccess: () => {
      void utils.mcp.getMcpServerTools.invalidate({ id: serverId });
      void utils.mcp.listMcpServers.invalidate();
      showSuccessToast(`${serverName} tools updated: ${enabled.size} enabled`);
      onOpenChange(false);
    },
    onError: showTrpcErrorToast,
  });

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }, [items, search]);

  const toggle = (name: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      await saveMutation.mutateAsync({
        id: serverId,
        allowedToolNames: Array.from(enabled),
      });
    } catch {
      // toast handled by onError
    }
  };

  const isLoading = toolsQuery.isLoading;
  const hasError = toolsQuery.error;
  const isMutating = saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[600px]">
        <DialogHeader className="space-y-1 border-b px-6 py-4 text-left">
          <div className="flex items-center justify-between gap-3 pr-8">
            <DialogTitle className="text-base">{serverName} tools</DialogTitle>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {enabled.size} of {items.length}
            </span>
          </div>
          <DialogDescription className="text-sm">
            The agent can only call tools you enable here. Tools added to the
            server later are off by default.
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
                : "No tools returned by this MCP server."}
            </p>
          ) : (
            <div className="space-y-1.5">
              {filteredItems.map((item) => (
                <label
                  key={item.name}
                  htmlFor={`mcp-tool-${item.name}`}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-2.5 hover:border-border hover:bg-muted/40"
                >
                  <Switch
                    id={`mcp-tool-${item.name}`}
                    checked={enabled.has(item.name)}
                    onCheckedChange={() => toggle(item.name)}
                    disabled={isMutating}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <Label
                        htmlFor={`mcp-tool-${item.name}`}
                        className="cursor-pointer text-sm font-medium"
                      >
                        {item.name}
                      </Label>
                    </div>
                    {item.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 border-t px-6 py-3 sm:flex-row sm:justify-end">
          <DialogClose asChild>
            <Button variant="ghost" disabled={isMutating}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => void handleSave()}
            disabled={isLoading || isMutating || !!hasError}
          >
            {isMutating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" /> Save changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
