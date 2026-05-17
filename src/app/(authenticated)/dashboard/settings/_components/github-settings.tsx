"use client";

import moment from "moment";
import { AlertTriangle } from "lucide-react";
import { trpc } from "~/clients/trpc";
import type { RouterOutputs } from "~/clients/trpc";

type BlockedAction =
  RouterOutputs["toolkits"]["getRecentGithubBlocks"]["items"][number];
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

const BLOCK_REASON_LABEL: Record<string, string> = {
  not_pinned: "Not in pinned set",
  destructive_blocked: "Destructive action",
  org_level_blocked: "Org-level action",
  search_blocked: "Cross-repo search",
  url_arg_refused: "URL-shaped arg refused",
  no_pins_configured: "No pins configured",
};

export function GithubSettings() {
  const pinned = trpc.toolkits.getGithubPinnedRepos.useQuery();
  const blocks = trpc.toolkits.getRecentGithubBlocks.useQuery({ limit: 10 });

  const pinnedCount = pinned.data?.pinnedRepos.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub</CardTitle>
        <CardDescription>
          Pinned repos are configured on the Toolkits page. This card shows
          recent blocked actions for visibility.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Recent blocks */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <h4 className="text-sm font-medium">Recently blocked agent actions</h4>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {pinnedCount === 0
              ? "All GitHub actions are blocked until you pin at least one repo on the Toolkits page."
              : `The agent is restricted to ${pinnedCount} pinned repo${pinnedCount === 1 ? "" : "s"}. Anything outside is recorded here.`}
          </p>

          {blocks.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : blocks.error ? (
            <p className="text-sm text-destructive">
              Failed to load recent blocks.
            </p>
          ) : (blocks.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              No blocked actions yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {blocks.data!.items.map((b: BlockedAction) => (
                <li
                  key={b.id}
                  className="flex flex-col gap-1 rounded-md border border-border bg-card p-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-mono font-medium text-foreground">
                      {b.toolSlug}
                    </span>
                    <span className="text-muted-foreground">
                      {BLOCK_REASON_LABEL[b.reason] ?? b.reason}
                      {b.attemptedRepo ? ` · ${b.attemptedRepo}` : ""}
                    </span>
                  </div>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {moment(b.createdAt).fromNow()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
