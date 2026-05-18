import type { Tool } from "ai";

import { db } from "~/server/clients/db";
import { decryptSecret } from "~/server/lib/crypto";

import { createMcpClient } from "./mcp-client-factory";

/**
 * Loads user-configured MCP servers at the start of an agent turn and
 * returns the merged tool dict + cleanup thunks.
 *
 * Failure semantics:
 *  - One server failing (timeout, bad auth, server down) MUST NOT break
 *    the agent. We log, update `lastConnectionError` (debounced — only
 *    when the message changes), and return `{}` for that server.
 *  - A global wall-clock cap (default 3500ms) protects first-token
 *    latency against a slow MCP server. Servers that miss the deadline
 *    are dropped from this turn only; they retry on the next turn.
 *
 * Cleanup: `close()` thunks are returned, NOT detached. The caller
 * (setup.ts) is responsible for awaiting them in the `onFinish` callback
 * so cleanup runs while the serverless runtime is still keeping the
 * function alive.
 */

const PER_SERVER_TIMEOUT_MS = 3000;
const GLOBAL_BUDGET_MS = 3500;

export type LoadMcpToolsResult = {
  tools: Record<string, Tool>;
  cleanups: Array<() => Promise<void>>;
};

export async function loadMcpTools(opts: {
  instanceId: string;
}): Promise<LoadMcpToolsResult> {
  const servers = await db.composioClawMcpServer.findMany({
    where: { instanceId: opts.instanceId, enabled: true },
    select: {
      id: true,
      slug: true,
      url: true,
      transport: true,
      authHeaderEncrypted: true,
      allowedToolNames: true,
      lastConnectionError: true,
    },
  });

  if (servers.length === 0) {
    return { tools: {}, cleanups: [] };
  }

  const tools: Record<string, Tool> = {};
  const cleanups: Array<() => Promise<void>> = [];

  // Per-server promise. Resolves to either { tools, cleanup } or null on
  // failure. Failure is fully handled inside — never re-throws.
  const perServerPromises = servers.map(async (server) => {
    try {
      const authHeader = server.authHeaderEncrypted
        ? decryptSecret(server.authHeaderEncrypted)
        : null;

      const handle = await createMcpClient({
        url: server.url,
        transport: server.transport === "sse" ? "sse" : "http",
        authHeader,
        toolPrefix: `mcp__${server.slug}__`,
        allowedToolNames: server.allowedToolNames,
        signal: AbortSignal.timeout(PER_SERVER_TIMEOUT_MS),
      });

      // Best-effort: clear any stale `lastConnectionError` and stamp the
      // success timestamp. Fire-and-forget so a DB hiccup never blocks
      // the chat. Only write when the prior error existed (debounce).
      void db.composioClawMcpServer
        .update({
          where: { id: server.id },
          data: {
            lastConnectedAt: new Date(),
            ...(server.lastConnectionError ? { lastConnectionError: null } : {}),
            ...(handle.protocolVersion
              ? { protocolVersion: handle.protocolVersion }
              : {}),
          },
        })
        .catch((err) => {
          console.error("[mcp] success-write failed:", err);
        });

      return { handle, slug: server.slug };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown MCP connect failure.";
      // Debounce error writes to avoid hammering the DB during outages.
      if (server.lastConnectionError !== message) {
        void db.composioClawMcpServer
          .update({
            where: { id: server.id },
            data: { lastConnectionError: message },
          })
          .catch((dbErr) => {
            console.error("[mcp] error-write failed:", dbErr);
          });
      }
      console.error(
        `[mcp] server "${server.slug}" failed to load tools:`,
        message,
      );
      return null;
    }
  });

  // Race against a global wall-clock cap so a slow server doesn't tank
  // first-token latency. Promises that miss the deadline are dropped
  // from this turn — but they were started, so their cleanup MUST run
  // even if they resolve late.
  let timedOut = false;
  const settled = await Promise.race([
    Promise.allSettled(perServerPromises),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve("timeout");
      }, GLOBAL_BUDGET_MS),
    ),
  ]);

  if (settled === "timeout") {
    // Best-effort: collect any handles that resolve later and close them.
    // We DO NOT await — this fire-and-forget cleanup runs in the
    // background and is bounded by the per-server timeout (3s).
    for (const promise of perServerPromises) {
      void promise
        .then((result) => {
          if (result?.handle) {
            return result.handle.close().catch(() => undefined);
          }
        })
        .catch(() => undefined);
    }
    console.warn(
      `[mcp] global ${GLOBAL_BUDGET_MS}ms budget exceeded — dropping slow servers for this turn`,
    );
    return { tools: {}, cleanups: [] };
  }

  // settled is the resolved Promise.allSettled array.
  for (const outcome of settled) {
    if (outcome.status !== "fulfilled" || outcome.value === null) {
      continue;
    }
    const { handle } = outcome.value;
    for (const [name, t] of Object.entries(handle.tools)) {
      tools[name] = t;
    }
    cleanups.push(() => handle.close());
  }

  // Reference timedOut to silence the "assigned but never read" warning
  // — the guard against late writes lives in the race resolution above.
  void timedOut;

  return { tools, cleanups };
}
