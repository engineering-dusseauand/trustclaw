"use client";

import { useState } from "react";
import { Settings2, Trash2, Server } from "lucide-react";
import { trpc } from "~/clients/trpc";
import {
  showSuccessToast,
  showTrpcErrorToast,
} from "~/components/core/toast-notifications";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Switch } from "~/components/ui/switch";

import { McpToolsAllowlistDialog } from "./mcp-tools-allowlist-dialog";

type McpServerCardProps = {
  server: {
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    hasAuth: boolean;
    allowedToolNamesCount: number;
    lastConnectionError: string | null;
    lastConnectedAt: Date | null;
  };
};

/**
 * One MCP server in the dashboard grid. Square card matching the
 * Composio toolkit cards for visual cohesion.
 */
export function McpServerCard({ server }: McpServerCardProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const utils = trpc.useUtils();

  const updateMutation = trpc.mcp.updateMcpServer.useMutation({
    onSuccess: () => {
      void utils.mcp.listMcpServers.invalidate();
    },
    onError: showTrpcErrorToast,
  });

  const deleteMutation = trpc.mcp.deleteMcpServer.useMutation({
    onSuccess: () => {
      void utils.mcp.listMcpServers.invalidate();
      showSuccessToast(`Removed "${server.name}"`);
      setDeleteOpen(false);
    },
    onError: showTrpcErrorToast,
  });

  const toggleEnabled = async (next: boolean) => {
    try {
      await updateMutation.mutateAsync({ id: server.id, enabled: next });
    } catch {
      // toast handled by onError
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync({ id: server.id });
    } catch {
      // toast handled by onError
    }
  };

  const hasError = !!server.lastConnectionError;
  const statusLabel = !server.enabled
    ? { color: "amber", text: "Disabled" }
    : hasError
      ? { color: "red", text: "Error" }
      : server.lastConnectedAt
        ? { color: "green", text: "Connected" }
        : { color: "muted", text: "Pending" };

  const statusClass =
    statusLabel.color === "green"
      ? "bg-green-500/10 text-green-700 dark:text-green-400"
      : statusLabel.color === "red"
        ? "bg-destructive/10 text-destructive"
        : statusLabel.color === "amber"
          ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          : "bg-muted text-muted-foreground";

  return (
    <>
      <article className="relative flex flex-col gap-3 rounded-xl border-[2px] border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Server className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">{server.name}</h3>
              <p className="truncate text-xs text-muted-foreground" title={server.url}>
                {new URL(server.url).hostname}
              </p>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
            title={server.lastConnectionError ?? undefined}
          >
            {statusLabel.text}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {server.allowedToolNamesCount} tool
            {server.allowedToolNamesCount === 1 ? "" : "s"} enabled
          </span>
          {server.hasAuth ? <span>Auth set</span> : null}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <Switch
              checked={server.enabled}
              onCheckedChange={(next) => void toggleEnabled(next)}
              disabled={updateMutation.isPending}
              aria-label={`Enable ${server.name}`}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setToolsOpen(true)}
              disabled={!server.enabled}
            >
              <Settings2 className="mr-1.5 h-4 w-4" />
              Manage tools
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setDeleteOpen(true)}
            aria-label={`Delete ${server.name}`}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </article>

      <McpToolsAllowlistDialog
        open={toolsOpen}
        onOpenChange={setToolsOpen}
        serverId={server.id}
        serverName={server.name}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this MCP server?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent will no longer see tools from <strong>{server.name}</strong>.
              You can re-add it later. Your other servers and Composio tools
              are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
