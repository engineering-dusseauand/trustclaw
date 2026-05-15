import { ToolLoopAgent, stepCountIs } from "ai";
import type { ToolSet, SystemModelMessage } from "ai";
import { db } from "~/server/clients/db";
import { createComposioClient } from "~/server/clients/composio";
import { buildSystemPrompt } from "./system-prompt";
import {
  createCustomTools,
  searchMemoriesForContext,
} from "./tools";
import { getContextWindow } from "./context/context-window";
import { pruneContext } from "./context/context-pruning";
import {
  loadContextMessages,
  buildContext,
  toPlainRecordSafe,
  toPrismaJson,
  runPostResponseTasks,
  sanitizeString,
  deepSanitize,
} from "./context/build-context";
import {
  DEFAULT_COMPACTION_SETTINGS,
  type CompactionSettings,
} from "./context/token-estimation";
import { stripToolResultEchoes } from "./strip-tool-echoes";
import { clearStreamingMessage } from "~/server/clients/redis";
import type { ReconstructedMessage } from "./types";

type MessageSource = "web" | "telegram" | "cron";

/**
 * Wraps every tool's execute function to sanitize its return value,
 * replacing lone Unicode surrogates with U+FFFD. Composio tool results
 * (e.g. scraped web pages, email bodies) can contain malformed Unicode
 * that produces invalid JSON when the AI SDK serializes the request
 * body for the Anthropic API.
 */
function sanitizeToolResults(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (tool.execute) {
      const originalExecute = tool.execute;
      wrapped[name] = {
        ...tool,
        execute: async (...args: Parameters<typeof originalExecute>) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- tool execute returns unknown/any; deepSanitize preserves the shape
          const result = await originalExecute(...args);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return deepSanitize(result);
        },
      };
    } else {
      wrapped[name] = tool;
    }
  }
  return wrapped;
}

/**
 * Supabase Management API tokens are user-account-scoped — Supabase does
 * not issue project-scoped tokens. TrustClaw uses Composio's tool router
 * mode, which exposes only two meta-tools to the agent
 * (COMPOSIO_SEARCH_TOOLS, COMPOSIO_MULTI_EXECUTE_TOOL) — actual toolkit
 * actions like SUPABASE_LIST_TABLES are dispatched dynamically through
 * MULTI_EXECUTE_TOOL. So scoping must happen at the meta-tool layer.
 *
 * When a `pinnedRef` is set, this wrapper:
 *
 *  1. Wraps MULTI_EXECUTE_TOOL to inspect the `tools[]` batch. Org-level
 *     Supabase actions (list/create projects, list orgs) are blocked
 *     with a synthesized error. Project-scoped actions get their
 *     `project_id` / `project_ref` arg overwritten with the pin.
 *  2. Wraps SEARCH_TOOLS to scrub Supabase from `toolkit_connection_statuses`
 *     and remove org-level Supabase tool schemas from the search results,
 *     so the agent cannot enumerate other projects via tool discovery.
 *
 * When no project is pinned, every Supabase action in a MULTI_EXECUTE_TOOL
 * batch is rejected with an instructive error.
 */
const SUPABASE_ORG_LEVEL_TOOLS = new Set([
  "SUPABASE_LIST_ALL_PROJECTS",
  "SUPABASE_LIST_PROJECTS",
  "SUPABASE_CREATE_PROJECT",
  "SUPABASE_LIST_ORGANIZATIONS",
  "SUPABASE_GET_ORGANIZATION",
  "SUPABASE_CREATE_ORGANIZATION",
]);

const NO_PIN_ERROR =
  "No Supabase project is pinned for this instance. Open " +
  "/dashboard/toolkits, click the Supabase card, and pick a project " +
  "before calling Supabase tools.";

const ORG_LEVEL_BLOCKED_ERROR =
  "This Supabase action operates at the organization level and is " +
  "blocked while a project is pinned. Only the pinned project can be " +
  "operated on.";

function isSupabaseSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.toUpperCase().startsWith("SUPABASE_");
}

function isSupabaseToolkit(name: unknown): boolean {
  return typeof name === "string" && name.toLowerCase() === "supabase";
}

/**
 * Rewrites the inner tools[] of a COMPOSIO_MULTI_EXECUTE_TOOL call:
 * - Org-level Supabase actions → marked blocked (their slug is replaced
 *   with a non-existent slug so Composio returns an error in that slot)
 * - Project-scoped Supabase actions → project_id/project_ref injected
 * - Everything else → unchanged
 *
 * Returns the rewritten input plus a list of indices we synthesized
 * errors for (used to patch the response on the way back).
 */
function rewriteMultiExecInput(
  input: unknown,
  pinnedRef: string | null,
): {
  input: unknown;
  blockedIndices: Map<number, string>;
} {
  const blockedIndices = new Map<number, string>();
  if (!input || typeof input !== "object") {
    return { input, blockedIndices };
  }

  const obj = { ...(input as Record<string, unknown>) };
  if (!Array.isArray(obj.tools)) return { input: obj, blockedIndices };

  obj.tools = obj.tools.map((entry, idx) => {
    if (!entry || typeof entry !== "object") return entry;
    const rec = { ...(entry as Record<string, unknown>) };
    const slug = rec.tool_slug;

    if (!isSupabaseSlug(slug)) return rec;
    const upper = slug.toUpperCase();

    if (!pinnedRef) {
      blockedIndices.set(idx, NO_PIN_ERROR);
      rec.tool_slug = `__BLOCKED_${upper}`;
      return rec;
    }

    if (SUPABASE_ORG_LEVEL_TOOLS.has(upper)) {
      blockedIndices.set(idx, ORG_LEVEL_BLOCKED_ERROR);
      rec.tool_slug = `__BLOCKED_${upper}`;
      return rec;
    }

    // Project-scoped: pin the project arg. The arguments may live under
    // `arguments` (Composio canonical), or be flattened onto the entry
    // (some shapes). Inject in both places to be safe.
    if (rec.arguments && typeof rec.arguments === "object") {
      rec.arguments = {
        ...(rec.arguments as Record<string, unknown>),
        project_id: pinnedRef,
        project_ref: pinnedRef,
      };
    } else {
      rec.arguments = { project_id: pinnedRef, project_ref: pinnedRef };
    }
    rec.project_id = pinnedRef;
    rec.project_ref = pinnedRef;
    return rec;
  });

  return { input: obj, blockedIndices };
}

/**
 * Patches MULTI_EXECUTE_TOOL's result so that blocked slots show our
 * synthesized error rather than Composio's "unknown tool slug" complaint.
 */
function patchMultiExecResult(
  result: unknown,
  blockedIndices: Map<number, string>,
): unknown {
  if (blockedIndices.size === 0) return result;
  if (!result || typeof result !== "object") return result;

  const out = { ...(result as Record<string, unknown>) };

  // Shape A: result.response_data is an array
  if (Array.isArray(out.response_data)) {
    out.response_data = out.response_data.map((item, i) =>
      blockedIndices.has(i)
        ? {
            ...(typeof item === "object" && item ? item : {}),
            successful: false,
            error: blockedIndices.get(i),
            data: {},
          }
        : item,
    );
  }

  // Shape B: out.data.results[].response
  if (out.data && typeof out.data === "object") {
    const dataObj = { ...(out.data as Record<string, unknown>) };
    if (Array.isArray(dataObj.results)) {
      dataObj.results = dataObj.results.map((item, i) => {
        if (!blockedIndices.has(i)) return item;
        const errResponse = {
          successful: false,
          error: blockedIndices.get(i),
          data: {},
        };
        if (!item || typeof item !== "object") return { response: errResponse };
        return { ...(item as Record<string, unknown>), response: errResponse };
      });
      out.data = dataObj;
    }
  }

  return out;
}

/**
 * Removes the Supabase entry from `toolkit_connection_statuses` and
 * filters org-level Supabase tool schemas out of SEARCH_TOOLS results.
 * The agent should not be able to learn other projects exist by
 * inspecting search responses.
 */
function scrubSearchToolsResult(
  result: unknown,
  pinnedRef: string | null,
): unknown {
  if (!pinnedRef || !result || typeof result !== "object") return result;

  // Composio responses look like { data: {...}, error, successful }.
  // The fields we care about sit inside `data`.
  const out = { ...(result as Record<string, unknown>) };
  const innerRaw = out.data;
  if (!innerRaw || typeof innerRaw !== "object") return out;

  const inner = { ...(innerRaw as Record<string, unknown>) };

  // 1. Replace any Supabase connection_status entry with a minimal stub
  //    that mentions only the pinned project. Drops emails, project lists,
  //    org names, and anything else Composio surfaces.
  if (Array.isArray(inner.toolkit_connection_statuses)) {
    inner.toolkit_connection_statuses = inner.toolkit_connection_statuses.map(
      (entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const rec = entry as Record<string, unknown>;
        if (!isSupabaseToolkit(rec.toolkit)) return entry;
        return {
          toolkit: rec.toolkit,
          has_active_connection: rec.has_active_connection,
          current_user_info: { pinned_project_ref: pinnedRef },
        };
      },
    );
  }

  // 2. Strip org-level Supabase tools from `tool_schemas`. The agent
  //    shouldn't even discover these exist while a pin is active.
  if (inner.tool_schemas && typeof inner.tool_schemas === "object") {
    const schemas = inner.tool_schemas as Record<string, unknown>;
    const filtered: Record<string, unknown> = {};
    for (const [slug, schema] of Object.entries(schemas)) {
      if (SUPABASE_ORG_LEVEL_TOOLS.has(slug.toUpperCase())) continue;
      filtered[slug] = schema;
    }
    inner.tool_schemas = filtered;
  }

  // 3. Strip org-level slugs out of the `results[].primary_tool_slugs` /
  //    `related_tool_slugs` arrays so suggestion paths can't surface them.
  if (Array.isArray(inner.results)) {
    inner.results = inner.results.map((r) => {
      if (!r || typeof r !== "object") return r;
      const rec = { ...(r as Record<string, unknown>) };
      for (const key of ["primary_tool_slugs", "related_tool_slugs"]) {
        const arr = rec[key];
        if (Array.isArray(arr)) {
          rec[key] = arr.filter(
            (s) => typeof s !== "string" || !SUPABASE_ORG_LEVEL_TOOLS.has(s.toUpperCase()),
          );
        }
      }
      return rec;
    });
  }

  out.data = inner;
  return out;
}

function pinSupabaseProjectRef(
  tools: ToolSet,
  pinnedRef: string | null,
): ToolSet {
  const wrapped: ToolSet = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (!tool.execute) {
      wrapped[name] = tool;
      continue;
    }

    // Tool router meta-tool: rewrite the inner batch.
    if (name.endsWith("MULTI_EXECUTE_TOOL")) {
      const originalExecute = tool.execute;
      wrapped[name] = {
        ...tool,
        execute: async (input: unknown, options) => {
          const { input: rewritten, blockedIndices } = rewriteMultiExecInput(
            input,
            pinnedRef,
          );
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const result = await originalExecute(rewritten, options);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return patchMultiExecResult(result, blockedIndices);
        },
      };
      continue;
    }

    // Tool router meta-tool: scrub project enumeration from the response.
    if (name.endsWith("SEARCH_TOOLS")) {
      const originalExecute = tool.execute;
      wrapped[name] = {
        ...tool,
        execute: async (input: unknown, options) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const result = await originalExecute(input, options);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return scrubSearchToolsResult(result, pinnedRef);
        },
      };
      continue;
    }

    // Static-mode fallback: if Composio ever returns SUPABASE_* tools
    // directly (e.g. without tool router), apply the prefix logic.
    if (name.startsWith("SUPABASE_")) {
      const upper = name.toUpperCase();
      if (pinnedRef && SUPABASE_ORG_LEVEL_TOOLS.has(upper)) continue;

      const originalExecute = tool.execute;
      if (!pinnedRef) {
        wrapped[name] = {
          ...tool,
          execute: async () => ({
            error: NO_PIN_ERROR,
            successful: false,
            data: {},
          }),
        };
        continue;
      }

      wrapped[name] = {
        ...tool,
        execute: async (input: unknown, options) => {
          const safeInput =
            input && typeof input === "object"
              ? { ...(input as Record<string, unknown>) }
              : {};
          safeInput.project_id = pinnedRef;
          safeInput.project_ref = pinnedRef;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return originalExecute(safeInput, options);
        },
      };
      continue;
    }

    wrapped[name] = tool;
  }
  return wrapped;
}

interface PrepareAgentRunParams {
  instanceId: string;
  userMessage: string;
  source: MessageSource;
  userMessageType?: "hidden";
}

interface PrepareAgentRunResult {
  agent: ToolLoopAgent;
  messages: ReconstructedMessage[];
}

type PrepareResult = { status: "ready"; result: PrepareAgentRunResult };

export async function prepareAgentRun(
  params: PrepareAgentRunParams,
): Promise<PrepareResult> {
  const { instanceId, userMessage, source, userMessageType } = params;

  const instance = await db.composioClawInstance.findUnique({
    where: { id: instanceId },
  });

  if (!instance) {
    throw new Error("Instance not found");
  }

  const user = await db.user.findUnique({
    where: { id: instance.userId },
    select: { timezone: true },
  });

  const userTimezone = user?.timezone ?? "UTC";

  const relevantMemories = await searchMemoriesForContext(instanceId, userMessage);

  const systemPrompt = sanitizeString(
    buildSystemPrompt({
      soulPrompt: instance.soulPrompt,
      identityPrompt: instance.identityPrompt,
      userPrompt: instance.userPrompt,
      relevantMemories,
      hasCompactionSummary: !!instance.lastCompactionSummary,
      userTimezone,
    }),
  );

  const dbMessages = await loadContextMessages(
    instanceId,
    instance.lastCompactionAt,
  );
  const aiMessages = buildContext(
    dbMessages,
    instance.lastCompactionSummary,
    userMessage,
  );

  const contextWindow = getContextWindow(instance.anthropicModel);
  const { messages: prunedMessages } = pruneContext(aiMessages, contextWindow);

  // Add cache breakpoint to last history message (before new user message)
  // so the conversation prefix is cached across turns
  if (prunedMessages.length >= 2) {
    const lastHistoryIndex = prunedMessages.length - 2;
    const msg = prunedMessages[lastHistoryIndex]!;
    prunedMessages[lastHistoryIndex] = {
      ...msg,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    };
  }

  await db.message.create({
    data: {
      instanceId,
      role: "user",
      content: [{ type: "text", text: userMessage }],
      source,
      ...(userMessageType && { messageType: userMessageType }),
    },
  });

  const composio = createComposioClient();
  const session = await composio.create(instance.userId, {
    manageConnections: {
      waitForConnections: true,
    },
  });
  const composioTools = await session.tools();

  const customTools = createCustomTools(instanceId, userTimezone);

  const pinnedComposioTools = pinSupabaseProjectRef(
    composioTools,
    instance.supabaseProjectRef,
  );

  const allTools: ToolSet = sanitizeToolResults({
    ...pinnedComposioTools,
    ...customTools,
  });

  // Pre-create assistant message row so we can update it in onFinish
  const assistantMessageRow = await db.message.create({
    data: {
      instanceId,
      role: "assistant",
      content: toPrismaJson([]),
      source,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  });

  const modelString = instance.anthropicModel.startsWith("anthropic/")
    ? instance.anthropicModel
    : `anthropic/${instance.anthropicModel}`;
  const model = modelString;

  const agent = new ToolLoopAgent({
    model,
    instructions: {
      role: "system",
      content: systemPrompt,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" } },
      },
    } satisfies SystemModelMessage,
    tools: allTools,
    stopWhen: stepCountIs(100),
    onFinish: async (result) => {
      try {
        const { totalUsage, steps } = result;
        const inputTokens = totalUsage.inputTokens ?? 0;
        const outputTokens = totalUsage.outputTokens ?? 0;
        const cacheReadTokens =
          totalUsage.inputTokenDetails?.cacheReadTokens ?? 0;
        const cacheWriteTokens =
          totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0;

        // Build assistant content from steps (UIMessage parts format)
        const assistantParts: Array<Record<string, unknown>> = [];

        for (const step of steps) {
          for (let i = 0; i < step.toolCalls.length; i++) {
            const tc = step.toolCalls[i]!;
            const tr = step.toolResults[i];
            const tcInput = toPlainRecordSafe(tc.input);
            const tcResult = tr ? toPlainRecordSafe(tr.output) : null;

            assistantParts.push({
              type: "dynamic-tool" as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              state: tcResult ? "output-available" : "input-available",
              input: tcInput,
              output: tcResult ?? {},
            });
          }

          const stepText = stripToolResultEchoes(step.text);
          if (stepText) {
            assistantParts.push({ type: "text" as const, text: stepText });
          }
        }

        // Update the pre-created assistant message with final content + totals
        await db.message.update({
          where: { id: assistantMessageRow.id },
          data: {
            content: toPrismaJson(assistantParts),
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
          },
        });

        // Fire-and-forget post-response tasks
        const totalContextTokens = inputTokens + outputTokens;
        const settings: CompactionSettings = {
          contextWindow,
          ...DEFAULT_COMPACTION_SETTINGS,
        };

        void runPostResponseTasks({
          instanceId,
          instance: {
            anthropicModel: instance.anthropicModel,
            compactionCount: instance.compactionCount,
            memoryFlushCount: instance.memoryFlushCount,
            lastCompactionSummary: instance.lastCompactionSummary,
            lastCompactionAt: instance.lastCompactionAt,
          },
          contextTokens: totalContextTokens,
          settings,
          prunedMessages,
        });
      } catch (error) {
        console.error("[agent/onFinish] post-stream processing failed:", error);
      } finally {
        await clearStreamingMessage(instanceId).catch((error) =>
          console.error(
            "[agent/onFinish] clearStreamingMessage failed:",
            error,
          ),
        );
      }
    },
  });

  return {
    status: "ready",
    result: {
      agent,
      messages: prunedMessages,
    },
  };
}

export type {
  PrepareAgentRunParams,
  PrepareResult,
  PrepareAgentRunResult,
  MessageSource,
};
