import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────
// Hoisted so vi.mock can reference them. The route imports all of these at
// module load time; we capture each call surface so individual tests can
// program the desired return value per scenario.

const supabaseGetUserMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: supabaseGetUserMock },
  })),
}));

const findUniqueInstanceMock = vi.hoisted(() => vi.fn());
vi.mock("~/server/clients/db", () => ({
  db: {
    composioClawInstance: {
      findUnique: findUniqueInstanceMock,
    },
  },
}));

const prepareAgentRunMock = vi.hoisted(() => vi.fn());
vi.mock("~/server/api/routers/trustclaw/agent/setup", () => ({
  prepareAgentRun: prepareAgentRunMock,
}));

const setStreamingMessageMock = vi.hoisted(() => vi.fn());
const getStreamingMessageMock = vi.hoisted(() => vi.fn());
vi.mock("~/server/clients/redis", () => ({
  setStreamingMessage: setStreamingMessageMock,
  getStreamingMessage: getStreamingMessageMock,
  // Used by `./stream-store` transitively; stub them out so the import
  // doesn't blow up trying to read REDIS_URL.
  getRedisSubscriber: vi.fn(() => null),
  getRedisPublisher: vi.fn(() => null),
  isRedisConfigured: vi.fn(() => false),
}));

// Mock the stream-store directly so we don't pull in resumable-stream.
vi.mock("../stream-store", () => ({
  getStreamContext: vi.fn(() => null),
}));

// ─── Import-under-test ───────────────────────────────────────────────────────

const { POST, GET } = await import("../route");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePostRequest(body: unknown): Request {
  return new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(streamId?: string): Request {
  const url = new URL("https://example.test/api/chat");
  if (streamId) url.searchParams.set("streamId", streamId);
  return new Request(url.toString(), { method: "GET" });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/chat - auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no Supabase session", async () => {
    supabaseGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const res = await POST(
      makePostRequest({
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("returns 401 when the user has a session but no ComposioClawInstance", async () => {
    // Real user, but the DB lookup turns up nothing. Callers cannot
    // distinguish this from "no session" - that's intentional, both
    // paths return 401 with the same body.
    supabaseGetUserMock.mockResolvedValueOnce({
      data: { user: { id: "user_with_no_instance" } },
    });
    findUniqueInstanceMock.mockResolvedValueOnce(null);

    const res = await POST(
      makePostRequest({
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
    );

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });
});

describe("POST /api/chat - body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseGetUserMock.mockResolvedValue({
      data: { user: { id: "user_1" } },
    });
    findUniqueInstanceMock.mockResolvedValue({ id: "instance_1" });
  });

  it("returns 400 when the user text is empty", async () => {
    const res = await POST(
      makePostRequest({
        messages: [{ role: "user", parts: [{ type: "text", text: "" }] }],
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Empty message");
    // prepareAgentRun must not be invoked when body is invalid.
    expect(prepareAgentRunMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the user text is whitespace only", async () => {
    const res = await POST(
      makePostRequest({
        messages: [{ role: "user", parts: [{ type: "text", text: "   \n\t " }] }],
      }),
    );

    expect(res.status).toBe(400);
    expect(prepareAgentRunMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/chat - auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no Supabase session (regression: GET previously crashed)", async () => {
    // Before the auth refactor, GET had no null check and would throw
    // `Cannot read properties of null (reading 'id')` when an
    // unauthenticated client retried a stream. This test guards that
    // behaviour going forward.
    supabaseGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    const res = await GET(makeGetRequest("some-stream-id"));

    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
  });

  it("returns 401 when the user has a session but no instance", async () => {
    supabaseGetUserMock.mockResolvedValueOnce({
      data: { user: { id: "user_with_no_instance" } },
    });
    findUniqueInstanceMock.mockResolvedValueOnce(null);

    const res = await GET(makeGetRequest("some-stream-id"));
    expect(res.status).toBe(401);
  });
});
