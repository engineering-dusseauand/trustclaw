import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "~/server/api/trpc";
import { createComposioClient } from "~/server/clients/composio";

/**
 * Loose accept of Composio's wrap. `successful` may be absent on some
 * action shapes; treat missing as success.
 */
const composioResponseShape = z.object({
  successful: z.boolean().optional(),
  error: z.string().nullable().optional(),
  data: z.unknown(),
});

/**
 * Permissive row schema. Supabase's Management API returns both a UUID
 * `id` and a short `ref` (e.g. "ylgtqgrajhyhjgydvyfb") — the `ref` is what
 * other Supabase APIs use as the project identifier, so we prefer it.
 * Composio may flatten or rename fields, so accept either shape.
 */
const projectRow = z
  .object({
    id: z.string().optional(),
    ref: z.string().optional(),
    project_ref: z.string().optional(),
    project_id: z.string().optional(),
    name: z.string().optional(),
    region: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();
type ProjectRow = z.infer<typeof projectRow>;

/** Walk a value and return every array we encounter. */
export function collectArrays(value: unknown, out: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) {
    out.push(value);
    for (const v of value) collectArrays(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectArrays(v, out);
    }
  }
  return out;
}

/** Pick the first array whose rows look like Supabase projects. */
export function findProjectArray(value: unknown): ProjectRow[] | null {
  for (const arr of collectArrays(value)) {
    if (arr.length === 0) continue;
    const head = arr[0];
    if (!head || typeof head !== "object") continue;
    const obj = head as Record<string, unknown>;
    // Must have at least one identifier-looking field.
    const hasId =
      typeof obj.ref === "string" ||
      typeof obj.id === "string" ||
      typeof obj.project_ref === "string" ||
      typeof obj.project_id === "string";
    if (!hasId) continue;
    const parsed = z.array(projectRow).safeParse(arr);
    if (parsed.success) return parsed.data;
  }
  return null;
}

export const listSupabaseProjects = protectedProcedure.query(async ({ ctx }) => {
  const userId = ctx.user.id;
  const composio = createComposioClient();

  let rawResponse: unknown;
  try {
    rawResponse = await composio.tools.execute("SUPABASE_LIST_ALL_PROJECTS", {
      userId,
      arguments: {},
      // Calling tools.execute() directly (vs. via a session) requires an
      // explicit toolkit version. We don't pin one here because project
      // enumeration is a stable, low-risk action and locking to a dated
      // version would just create busy-work on Composio's release cycle.
      dangerouslySkipVersionCheck: true,
    });
  } catch (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        error instanceof Error
          ? `Composio SUPABASE_LIST_ALL_PROJECTS failed: ${error.message}`
          : "Composio SUPABASE_LIST_ALL_PROJECTS failed",
    });
  }

  const parsed = composioResponseShape.safeParse(rawResponse);
  if (!parsed.success) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected response shape from Composio",
    });
  }

  if (parsed.data.successful === false) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        parsed.data.error ??
        "Composio could not list Supabase projects. Is Supabase connected?",
    });
  }

  const rows = findProjectArray(parsed.data.data);
  if (!rows) return { items: [] };

  // Normalize to { id, name, region, status }. `id` is the value we'll
  // pin — prefer the Supabase short ref over the UUID.
  const items = rows.map((row) => ({
    id: row.ref ?? row.project_ref ?? row.id ?? row.project_id ?? "",
    name: row.name ?? row.ref ?? row.id ?? "Unnamed project",
    region: row.region,
    status: row.status,
  }));

  return { items: items.filter((p) => p.id) };
});
