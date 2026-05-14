import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { createClient } from "~/lib/supabase/server";

// Context creation
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    headers: opts.headers,
    user,
    supabase,
  };
};

// tRPC initialization
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  sse: {
    maxDurationMs: 50_000, // Close gracefully before Vercel's serverless function timeout
    ping: {
      enabled: true,
      intervalMs: 15_000,
    },
    client: {
      reconnectAfterInactivityMs: 20_000,
    },
  },
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createCallerFactory = t.createCallerFactory;
export const router = t.router;

const authMiddleware = t.middleware(async ({ next, ctx }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/** Public procedure - session may be null. Use for unauthenticated endpoints. */
export const publicProcedure = t.procedure;

/** Protected procedure - session guaranteed. Throws UNAUTHORIZED if no session. */
export const protectedProcedure = t.procedure.use(authMiddleware);
