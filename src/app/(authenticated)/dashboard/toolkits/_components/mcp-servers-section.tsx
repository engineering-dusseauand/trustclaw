"use client";

import { Server } from "lucide-react";
import { trpc } from "~/clients/trpc";
import { Skeleton } from "~/components/ui/skeleton";

import { McpServerAddDialog } from "./mcp-server-add-dialog";
import { McpServerCard } from "./mcp-server-card";

/**
 * MCP Servers section on `/dashboard/toolkits`. Lives above the Composio
 * toolkit grid since user-managed servers are more salient than the
 * baseline integration list.
 */
export function McpServersSection() {
  const listQuery = trpc.mcp.listMcpServers.useQuery(undefined, {
    refetchOnMount: "always",
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">MCP Servers</h2>
          <p className="text-sm text-muted-foreground">
            Extend the agent with tools from remote MCP servers (DeepWiki, Nia,
            Devin, or your own).
          </p>
        </div>
        <McpServerAddDialog />
      </div>

      {listQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : listQuery.error ? (
        <p className="text-sm text-destructive">
          {listQuery.error.message ?? "Could not load MCP servers."}
        </p>
      ) : (listQuery.data?.items.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-8 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Server className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No MCP servers yet</p>
          <p className="max-w-md text-xs text-muted-foreground">
            Add one to extend the agent with tools from external services. The
            agent only sees servers and tools you explicitly enable.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {listQuery.data!.items.map((server) => (
            <McpServerCard key={server.id} server={server} />
          ))}
        </div>
      )}
    </section>
  );
}
