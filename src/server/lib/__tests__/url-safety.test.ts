import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:dns/promises so the SSRF check is deterministic across test runs.
const mockedLookup = vi.fn();

vi.mock("node:dns/promises", () => ({
  default: {
    lookup: (...args: unknown[]) => mockedLookup(...args),
  },
  lookup: (...args: unknown[]) => mockedLookup(...args),
}));

// Cast around the read-only `NODE_ENV` typing so tests can mutate it.
const procEnv = process.env as Record<string, string | undefined>;

let originalNodeEnv: string | undefined;

beforeEach(() => {
  originalNodeEnv = procEnv["NODE_ENV"];
  procEnv["NODE_ENV"] = "production";
  mockedLookup.mockReset();
  // Default: resolve to a public address.
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.resetModules();
});

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete procEnv["NODE_ENV"];
  } else {
    procEnv["NODE_ENV"] = originalNodeEnv;
  }
  vi.resetModules();
});

async function load() {
  return await import("../url-safety");
}

describe("validateMcpUrl", () => {
  it("accepts a public https URL", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://mcp.deepwiki.com/mcp");
    expect(result.ok).toBe(true);
  });

  it("rejects empty string", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/required/i);
  });

  it("rejects URLs over 2048 characters", async () => {
    const { validateMcpUrl } = await load();
    const url = "https://example.com/" + "a".repeat(2100);
    const result = await validateMcpUrl(url);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/2048/);
  });

  it("rejects malformed URLs", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("not-a-url");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/malformed/i);
  });

  it("rejects non-http(s) protocols", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("ftp://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/http\(s\)/i);
  });

  it("rejects plain http:// in production", async () => {
    procEnv["NODE_ENV"] = "production";
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("http://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/development/i);
  });

  it("allows http:// in development", async () => {
    procEnv["NODE_ENV"] = "development";
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("http://example.com");
    expect(result.ok).toBe(true);
  });

  it("rejects URLs with embedded userinfo", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://user:pass@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/userinfo/i);
  });

  it("rejects localhost by exact match", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://localhost/mcp");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/localhost/i);
  });

  it("rejects *.local hostnames", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://something.local/mcp");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/\.local/i);
  });

  it("rejects *.internal hostnames", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://api.internal/mcp");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/\.internal/i);
  });

  it("rejects URLs resolving to 127.0.0.1", async () => {
    mockedLookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://sneaky.example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/private IPv4/i);
  });

  it("rejects URLs resolving to 10.0.0.0/8", async () => {
    mockedLookup.mockResolvedValue([{ address: "10.5.6.7", family: 4 }]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://internal.example.com");
    expect(result.ok).toBe(false);
  });

  it("rejects URLs resolving to 192.168.x.x", async () => {
    mockedLookup.mockResolvedValue([{ address: "192.168.1.5", family: 4 }]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://internal.example.com");
    expect(result.ok).toBe(false);
  });

  it("rejects URLs resolving to 172.16-31.x.x", async () => {
    mockedLookup.mockResolvedValue([{ address: "172.20.0.1", family: 4 }]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://internal.example.com");
    expect(result.ok).toBe(false);
  });

  it("accepts 172.15.x.x (just outside the private range)", async () => {
    mockedLookup.mockResolvedValue([{ address: "172.15.0.1", family: 4 }]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://public.example.com");
    expect(result.ok).toBe(true);
  });

  it("rejects link-local 169.254.x.x", async () => {
    mockedLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://aws-metadata.example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/private/i);
  });

  it("rejects IPv6 loopback ::1", async () => {
    mockedLookup.mockResolvedValue([{ address: "::1", family: 6 }]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://sneaky.example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/private IPv6/i);
  });

  it("rejects IPv6 unique-local fc00::/7", async () => {
    mockedLookup.mockResolvedValue([{ address: "fc00::1", family: 6 }]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://sneaky.example.com");
    expect(result.ok).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 of private IPv4", async () => {
    mockedLookup.mockResolvedValue([
      { address: "::ffff:127.0.0.1", family: 6 },
    ]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://sneaky.example.com");
    expect(result.ok).toBe(false);
  });

  it("rejects when DNS lookup fails", async () => {
    mockedLookup.mockRejectedValue(new Error("ENOTFOUND"));
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://nonexistent.invalid");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/resolve/i);
  });

  it("rejects reserved low port (e.g. 22)", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://example.com:22");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/reserved/i);
  });

  it("accepts custom port in unprivileged range (e.g. 8443)", async () => {
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://example.com:8443/mcp");
    expect(result.ok).toBe(true);
  });

  it("rejects when ANY resolved address is private (multi-A response)", async () => {
    mockedLookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    const { validateMcpUrl } = await load();
    const result = await validateMcpUrl("https://mixed.example.com");
    expect(result.ok).toBe(false);
  });
});
