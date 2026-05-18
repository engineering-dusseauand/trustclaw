import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "~/server/api/trpc";
import { createComposioClient } from "~/server/clients/composio";
import {
  githubRepo,
  listGithubReposInput,
  type GithubRepo,
} from "./listGithubRepos.schema";

const composioResponseShape = z.object({
  successful: z.boolean().optional(),
  error: z.string().nullable().optional(),
  data: z.unknown(),
});

/** Walk the response tree and collect every array. */
function collectArrays(value: unknown, out: unknown[][] = []): unknown[][] {
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

/**
 * Normalises a raw GitHub repo row (which may come from Composio with
 * snake_case or camelCase keys) to the picker's expected shape.
 * Returns null if the row isn't recognisable as a repo.
 */
function normaliseRepoRow(row: unknown): GithubRepo | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const ownerLogin =
    typeof r.owner === "object" && r.owner !== null
      ? (r.owner as Record<string, unknown>).login
      : null;
  const repoName = typeof r.name === "string" ? r.name : null;
  const fullName =
    (typeof r.full_name === "string" ? r.full_name : null) ??
    (typeof r.fullName === "string" ? r.fullName : null) ??
    (typeof ownerLogin === "string" && repoName
      ? `${ownerLogin}/${repoName}`
      : null);
  if (!fullName) return null;

  const id = (typeof r.id === "number" || typeof r.id === "string") ? r.id : fullName;
  const description =
    typeof r.description === "string"
      ? r.description
      : r.description === null
        ? null
        : undefined;
  const isPrivate = typeof r.private === "boolean" ? r.private : undefined;
  const archived = typeof r.archived === "boolean" ? r.archived : undefined;
  const pushedAt =
    typeof r.pushed_at === "string"
      ? r.pushed_at
      : typeof r.pushedAt === "string"
        ? r.pushedAt
        : null;

  return githubRepo.parse({
    id,
    fullName,
    description,
    private: isPrivate,
    archived,
    pushedAt,
  });
}

export const listGithubRepos = protectedProcedure
  .input(listGithubReposInput)
  .query(async ({ ctx, input }) => {
    const userId = ctx.user.id;
    const composio = createComposioClient();

    let rawResponse: unknown;
    try {
      rawResponse = await composio.tools.execute(
        "GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER",
        {
          userId,
          arguments: {
            page: input.page,
            per_page: input.perPage,
            sort: "pushed",
            // GitHub's REST docs warn against combining `type` with
            // `visibility`/`affiliation`. We leave both unset to default
            // to "owner,collaborator,organization_member" + "all".
          },
          dangerouslySkipVersionCheck: true,
        },
      );
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error
            ? `Composio GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER failed: ${error.message}`
            : "Composio GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER failed",
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
          "Composio could not list GitHub repos. Is GitHub connected?",
      });
    }

    // Find the first array that contains rows we can parse as repos.
    let items: GithubRepo[] = [];
    for (const arr of collectArrays(parsed.data.data)) {
      if (arr.length === 0) continue;
      const normalised = arr
        .map(normaliseRepoRow)
        .filter((r): r is GithubRepo => r !== null);
      if (normalised.length > 0) {
        items = normalised;
        break;
      }
    }

    return {
      items,
      page: input.page,
      hasMore: items.length === input.perPage,
    };
  });
