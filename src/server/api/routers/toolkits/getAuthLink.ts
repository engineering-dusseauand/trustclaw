import { TRPCError } from "@trpc/server";
import { headers } from "next/headers";
import { protectedProcedure } from "~/server/api/trpc";
import { createComposioClient } from "~/server/clients/composio";
import { env } from "~/env";
import { getAuthLinkInput } from "./getAuthLink.schema";

export const getAuthLink = protectedProcedure
  .input(getAuthLinkInput)
  .mutation(async ({ ctx, input }) => {
    const userId = ctx.user.id;
    const composio = createComposioClient();
    const session = await composio.create(userId, {});

    // Get the origin from the request headers for the callback URL
    const headersList = await headers();
    const origin = headersList.get("origin") || headersList.get("referer")?.split("/").slice(0, 3).join("/") || env.NEXT_PUBLIC_APP_URL || "";
    const callbackUrl = `${origin}/dashboard/toolkits`;

    try {
      const connectionRequest = await session.authorize(input.toolkit, {
        callbackUrl,
      });
      const redirectUrl = connectionRequest.redirectUrl;

      if (!redirectUrl) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate OAuth URL for this toolkit",
        });
      }

      return { redirectUrl };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to authorize ${input.toolkit}`,
      });
    }
  });
