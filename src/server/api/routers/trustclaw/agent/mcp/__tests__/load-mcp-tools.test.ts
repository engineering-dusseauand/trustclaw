import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// Stable encryption key so encrypt → decrypt roundtrip works across the mock setup.
beforeEach(() => {
  process.env["MCP_ENCRYPTION_KEY"] = crypto.randomBytes(32).toString("base64");
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

// Type-only handles we use across tests.
type MockServer = {
  id: string;
  slug: string;
  url: string;
  transport: string;
  authHeaderEncrypted: string | null;
  allowedToolNames: string[];
  lastConnectionError: string | null;
};

function mockDb(servers: MockServer[]) {
  return {
    composioClawMcpServer: {
      findMany: vi.fn().mockResolvedValue(servers),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function mockFactory(
  factories: Record<
    string,
    (() => Promise<unknown>) | (() => unknown)
  >,
) {
  return {
    createMcpClient: vi.fn(async (opts: { url: string }) => {
      const factory = factories[opts.url];
      if (!factory) throw new Error(`No mock for ${opts.url}`);
      return await factory();
    }),
  };
}

describe("loadMcpTools", () => {
  it("returns empty result when no servers exist", async () => {
    vi.doMock("~/server/clients/db", () => ({ db: mockDb([]) }));
    vi.doMock(
      "~/server/api/routers/trustclaw/agent/mcp/mcp-client-factory",
      () => ({ createMcpClient: vi.fn() }),
    );
    const { loadMcpTools } = await import("../load-mcp-tools");
    const result = await loadMcpTools({ instanceId: "inst-1" });
    expect(result.tools).toEqual({});
    expect(result.cleanups).toEqual([]);
  });

  it("loads tools from a single healthy server with prefix", async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock("~/server/clients/db", () => ({
      db: mockDb([
        {
          id: "srv1",
          slug: "deepwiki_a3f2",
          url: "https://mcp.example.com/wiki",
          transport: "http",
          authHeaderEncrypted: null,
          allowedToolNames: ["search"],
          lastConnectionError: null,
        },
      ]),
    }));
    vi.doMock(
      "~/server/api/routers/trustclaw/agent/mcp/mcp-client-factory",
      () =>
        mockFactory({
          "https://mcp.example.com/wiki": () => ({
            tools: { "mcp__deepwiki_a3f2__search": { description: "search" } },
            toolMetadata: [],
            protocolVersion: "2025-06-18",
            close: closeSpy,
          }),
        }),
    );
    const { loadMcpTools } = await import("../load-mcp-tools");
    const result = await loadMcpTools({ instanceId: "inst-1" });
    expect(Object.keys(result.tools)).toEqual(["mcp__deepwiki_a3f2__search"]);
    expect(result.cleanups).toHaveLength(1);
    // Run cleanup; ensure it closes the client.
    await result.cleanups[0]!();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("isolates failure: bad server returns no tools but does not throw", async () => {
    vi.doMock("~/server/clients/db", () => ({
      db: mockDb([
        {
          id: "srv-bad",
          slug: "bad",
          url: "https://bad.example.com/mcp",
          transport: "http",
          authHeaderEncrypted: null,
          allowedToolNames: ["x"],
          lastConnectionError: null,
        },
      ]),
    }));
    vi.doMock(
      "~/server/api/routers/trustclaw/agent/mcp/mcp-client-factory",
      () =>
        mockFactory({
          "https://bad.example.com/mcp": () => {
            throw new Error("ECONNREFUSED");
          },
        }),
    );
    const { loadMcpTools } = await import("../load-mcp-tools");
    const result = await loadMcpTools({ instanceId: "inst-1" });
    expect(result.tools).toEqual({});
    expect(result.cleanups).toEqual([]);
  });

  it("merges tools from healthy server when peer fails", async () => {
    const closeSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock("~/server/clients/db", () => ({
      db: mockDb([
        {
          id: "srv-good",
          slug: "good_aaaa",
          url: "https://good.example.com/mcp",
          transport: "http",
          authHeaderEncrypted: null,
          allowedToolNames: ["ping"],
          lastConnectionError: null,
        },
        {
          id: "srv-bad",
          slug: "bad",
          url: "https://bad.example.com/mcp",
          transport: "http",
          authHeaderEncrypted: null,
          allowedToolNames: ["x"],
          lastConnectionError: null,
        },
      ]),
    }));
    vi.doMock(
      "~/server/api/routers/trustclaw/agent/mcp/mcp-client-factory",
      () =>
        mockFactory({
          "https://good.example.com/mcp": () => ({
            tools: { "mcp__good_aaaa__ping": { description: "ping" } },
            toolMetadata: [],
            protocolVersion: undefined,
            close: closeSpy,
          }),
          "https://bad.example.com/mcp": () => {
            throw new Error("server is down");
          },
        }),
    );
    const { loadMcpTools } = await import("../load-mcp-tools");
    const result = await loadMcpTools({ instanceId: "inst-1" });
    expect(Object.keys(result.tools)).toEqual(["mcp__good_aaaa__ping"]);
    expect(result.cleanups).toHaveLength(1);
  });

  it("writes lastConnectionError when the message changes (debounced)", async () => {
    const dbMock = mockDb([
      {
        id: "srv1",
        slug: "x_aaaa",
        url: "https://x.example.com/mcp",
        transport: "http",
        authHeaderEncrypted: null,
        allowedToolNames: [],
        lastConnectionError: "previous message",
      },
    ]);
    vi.doMock("~/server/clients/db", () => ({ db: dbMock }));
    vi.doMock(
      "~/server/api/routers/trustclaw/agent/mcp/mcp-client-factory",
      () =>
        mockFactory({
          "https://x.example.com/mcp": () => {
            throw new Error("new failure");
          },
        }),
    );
    const { loadMcpTools } = await import("../load-mcp-tools");
    await loadMcpTools({ instanceId: "inst-1" });
    // Fire-and-forget write — give the microtask a tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dbMock.composioClawMcpServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "srv1" },
        data: { lastConnectionError: "new failure" },
      }),
    );
  });

  it("skips DB write when error message is unchanged (debounced)", async () => {
    const dbMock = mockDb([
      {
        id: "srv1",
        slug: "x_aaaa",
        url: "https://x.example.com/mcp",
        transport: "http",
        authHeaderEncrypted: null,
        allowedToolNames: [],
        lastConnectionError: "same message",
      },
    ]);
    vi.doMock("~/server/clients/db", () => ({ db: dbMock }));
    vi.doMock(
      "~/server/api/routers/trustclaw/agent/mcp/mcp-client-factory",
      () =>
        mockFactory({
          "https://x.example.com/mcp": () => {
            throw new Error("same message");
          },
        }),
    );
    const { loadMcpTools } = await import("../load-mcp-tools");
    await loadMcpTools({ instanceId: "inst-1" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(dbMock.composioClawMcpServer.update).not.toHaveBeenCalled();
  });
});
