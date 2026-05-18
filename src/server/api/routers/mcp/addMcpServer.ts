import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";

import { protectedProcedure } from "~/server/api/trpc";
import { db } from "~/server/clients/db";
import { encryptSecret } from "~/server/lib/crypto";
import { validateMcpUrl } from "~/server/lib/url-safety";

import { addMcpServerInput } from "./addMcpServer.schema";
import { MAX_MCP_SERVERS_PER_INSTANCE } from "./shared.schema";

const NANOID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function nanoidSuffix(length = 4): string {
  // Crypto-random suffix using the same lowercase-alphanumeric charset
  // as our slug regex, avoiding the nanoid dependency.
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += NANOID_ALPHABET[bytes[i]! % NANOID_ALPHABET.length];
  }
  return out;
}

function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return base.length > 0 ? base : "server";
}

/**
 * Adds an MCP server for the current user's instance.
 *
 * - Validates URL via the SSRF guard.
 * - Caps total servers per instance to MAX_MCP_SERVERS_PER_INSTANCE.
 * - Generates an immutable `slug = <slugified-name>_<4-char-nanoid>`.
 *   Slug stability across renames keeps tool-name prefixes consistent
 *   in the agent's chat history.
 * - Encrypts `authHeader` if provided.
 * - Persists the user-supplied `allowedToolNames` (typically the
 *   discovered tools pre-checked from the test-connection preview).
 *
 * Returns the new row minus the ciphertext (a `hasAuth` boolean is
 * surfaced instead, so the UI knows whether to render "auth set").
 */
export const addMcpServer = protectedProcedure
  .input(addMcpServerInput)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user.id;

    const instance = await db.composioClawInstance.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!instance) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "TrustClaw instance not found",
      });
    }

    const urlCheck = await validateMcpUrl(input.url);
    if (!urlCheck.ok) {
      throw new TRPCError({ code: "BAD_REQUEST", message: urlCheck.reason });
    }

    const count = await db.composioClawMcpServer.count({
      where: { instanceId: instance.id },
    });
    if (count >= MAX_MCP_SERVERS_PER_INSTANCE) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `You can pin at most ${MAX_MCP_SERVERS_PER_INSTANCE} MCP servers.`,
      });
    }

    const authHeaderEncrypted = input.authHeader
      ? encryptSecret(input.authHeader)
      : null;

    // Generate a slug. Collision retry is bounded because each retry
    // adds a fresh 4-char random suffix; the per-instance unique
    // constraint will catch the collision and we'll regenerate.
    const baseSlug = slugifyName(input.name);
    let attempt = 0;
    while (attempt < 5) {
      const slug = `${baseSlug}_${nanoidSuffix(4)}`;
      try {
        const created = await db.composioClawMcpServer.create({
          data: {
            instanceId: instance.id,
            slug,
            name: input.name.trim(),
            url: input.url,
            transport: input.transport,
            authHeaderEncrypted,
            allowedToolNames: input.allowedToolNames,
            enabled: true,
          },
          select: {
            id: true,
            slug: true,
            name: true,
            url: true,
            transport: true,
            enabled: true,
            allowedToolNames: true,
            authHeaderEncrypted: true,
            createdAt: true,
          },
        });
        return {
          id: created.id,
          slug: created.slug,
          name: created.name,
          url: created.url,
          transport: created.transport,
          enabled: created.enabled,
          allowedToolNamesCount: created.allowedToolNames.length,
          hasAuth: created.authHeaderEncrypted !== null,
          createdAt: created.createdAt,
        };
      } catch (err: unknown) {
        // Prisma P2002 = unique constraint violation. We only retry on
        // slug collisions; any other failure propagates.
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err as { code?: string }).code === "P2002"
        ) {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Could not generate a unique slug after several attempts.",
    });
  });
