import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// Both clients are imported eagerly by clearConversation.ts at module load
// time, so the mocks need to be in place before we import the module.

const dbMock = vi.hoisted(() => {
  // Build a Prisma-shaped surface: composioClawInstance.findUnique +
  // $transaction. $transaction is invoked with a callback that receives
  // a `tx` (transactional client). We model both `tx.message.deleteMany`
  // and `tx.composioClawInstance.update`.
  const composioClawInstance = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const message = {
    deleteMany: vi.fn(),
  };
  const $transaction = vi.fn(
    async (
      callback: (tx: {
        composioClawInstance: typeof composioClawInstance;
        message: typeof message;
      }) => Promise<unknown>,
    ) => callback({ composioClawInstance, message }),
  );
  return {
    composioClawInstance,
    message,
    $transaction,
  };
});

vi.mock("~/server/clients/db", () => ({
  db: dbMock,
}));

const clearStreamingMessageMock = vi.hoisted(() => vi.fn());
vi.mock("~/server/clients/redis", () => ({
  clearStreamingMessage: clearStreamingMessageMock,
}));

// `~/server/api/trpc` imports next/headers via the supabase server client,
// so stub that out too. We only care about `protectedProcedure` providing
// a context-aware caller; the procedure receives ctx directly in our tests
// because we call the resolver fn rather than going through the router.
vi.mock("~/server/api/trpc", async () => {
  const actual = await vi.importActual<typeof import("@trpc/server")>(
    "@trpc/server",
  );
  // Build a minimal procedure factory that exposes a `.mutation(fn)`
  // returning a callable wrapper, mirroring tRPC's surface enough for
  // clearConversation.ts to bind to.
  type Resolver = (opts: {
    ctx: { user: { id: string } };
  }) => Promise<unknown>;
  const protectedProcedure = {
    mutation(fn: Resolver) {
      // Expose the resolver so tests can call it directly with a fake ctx.
      return { _resolver: fn };
    },
  };
  return { protectedProcedure, TRPCError: actual.TRPCError };
});

// ─── Import-under-test ───────────────────────────────────────────────────────

// We import after mocks are registered. The resolver is exposed on the
// procedure via the stub above.
const { clearConversation } = await import("../clearConversation");
const resolver = (
  clearConversation as unknown as {
    _resolver: (opts: {
      ctx: { user: { id: string } };
    }) => Promise<{ deletedMessageCount: number }>;
  }
)._resolver;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("clearConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStreamingMessageMock.mockReset();
    clearStreamingMessageMock.mockResolvedValue(undefined);
  });

  it("throws TRPCError NOT_FOUND when the user has no instance", async () => {
    dbMock.composioClawInstance.findUnique.mockResolvedValueOnce(null);

    await expect(
      resolver({ ctx: { user: { id: "user_no_instance" } } }),
    ).rejects.toMatchObject({
      // TRPCError.code is exposed as a string property.
      code: "NOT_FOUND",
    });
  });

  it("deletes all messages for the instance and resets compaction state", async () => {
    dbMock.composioClawInstance.findUnique.mockResolvedValueOnce({
      id: "instance_1",
    });
    dbMock.message.deleteMany.mockResolvedValueOnce({ count: 42 });
    dbMock.composioClawInstance.update.mockResolvedValueOnce({});

    const result = await resolver({ ctx: { user: { id: "user_1" } } });

    expect(result).toEqual({ deletedMessageCount: 42 });

    expect(dbMock.message.deleteMany).toHaveBeenCalledWith({
      where: { instanceId: "instance_1" },
    });

    // The instance update must reset compaction-related fields and leave
    // everything else alone (in particular, supabaseProjectRef MUST NOT be
    // included in the data payload).
    expect(dbMock.composioClawInstance.update).toHaveBeenCalledTimes(1);
    const updateCall = dbMock.composioClawInstance.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateCall.where).toEqual({ id: "instance_1" });
    expect(updateCall.data).toEqual({
      lastCompactionSummary: null,
      lastCompactionAt: null,
      tokensAtCompaction: null,
      compactionCount: 0,
      memoryFlushCount: 0,
    });

    // Critical regression guard: the pinned Supabase project ref MUST NOT
    // be touched by clearConversation. If a future refactor accidentally
    // adds it to the reset list, this test should fail loudly.
    expect(updateCall.data).not.toHaveProperty("supabaseProjectRef");
  });

  it("calls clearStreamingMessage with the instance id", async () => {
    dbMock.composioClawInstance.findUnique.mockResolvedValueOnce({
      id: "instance_1",
    });
    dbMock.message.deleteMany.mockResolvedValueOnce({ count: 0 });
    dbMock.composioClawInstance.update.mockResolvedValueOnce({});

    await resolver({ ctx: { user: { id: "user_1" } } });

    expect(clearStreamingMessageMock).toHaveBeenCalledWith("instance_1");
  });

  it("swallows clearStreamingMessage rejection (best-effort)", async () => {
    dbMock.composioClawInstance.findUnique.mockResolvedValueOnce({
      id: "instance_1",
    });
    dbMock.message.deleteMany.mockResolvedValueOnce({ count: 3 });
    dbMock.composioClawInstance.update.mockResolvedValueOnce({});
    clearStreamingMessageMock.mockRejectedValueOnce(
      new Error("redis is down"),
    );

    // The mutation must NOT reject even though clearStreamingMessage did.
    await expect(
      resolver({ ctx: { user: { id: "user_1" } } }),
    ).resolves.toEqual({
      deletedMessageCount: 3,
    });
  });
});

// Re-export TRPCError to keep the import live; otherwise tree-shaking could
// drop the error class and the toMatchObject({ code: "NOT_FOUND" }) check
// would silently match anything that happens to have that shape.
export { TRPCError };
