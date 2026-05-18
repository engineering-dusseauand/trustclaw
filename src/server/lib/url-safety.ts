import type { LookupAddress } from "node:dns";
import dns from "node:dns/promises";
import net from "node:net";

import { env } from "~/env";

/**
 * Validates a user-supplied URL before TrustClaw uses it for outbound
 * requests (e.g. MCP server endpoints).
 *
 * Defense-in-depth, not a hard boundary:
 *  - Catches casual misconfiguration (typing `localhost`, copying a
 *    `192.168.x.x` URL).
 *  - Catches naive enumeration attempts ("hit internal IPs to map the
 *    network").
 *  - Does NOT defend against DNS rebinding: an attacker can return a
 *    public IP at validate time and a private IP at fetch time.
 *
 * If TrustClaw ever opens to untrusted multi-tenant users, harden the
 * fetch layer too (e.g. resolve + bind to the IP from this check, or
 * use a vetted SSRF-protection library).
 */

const MAX_URL_LENGTH = 2048;
const ALLOWED_PORTS_LOW = new Set([80, 443]);
const BLOCKED_HOSTNAME_SUFFIXES = [
  ".local",
  ".internal",
  ".localhost",
];
const BLOCKED_EXACT_HOSTNAMES = new Set(["localhost"]);

type ValidationResult =
  | { ok: true; parsedUrl: URL }
  | { ok: false; reason: string };

export async function validateMcpUrl(url: string): Promise<ValidationResult> {
  if (typeof url !== "string" || url.length === 0) {
    return { ok: false, reason: "URL is required." };
  }
  if (url.length > MAX_URL_LENGTH) {
    return {
      ok: false,
      reason: `URL exceeds ${MAX_URL_LENGTH} characters.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "URL is malformed." };
  }

  // Protocol
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      reason: `Only http(s) URLs are allowed (got "${parsed.protocol}").`,
    };
  }
  if (parsed.protocol === "http:" && env.NODE_ENV !== "development") {
    return {
      ok: false,
      reason:
        "Plain http:// URLs are only allowed in development. Use https://.",
    };
  }

  // No embedded credentials in the URL.
  if (parsed.username !== "" || parsed.password !== "") {
    return {
      ok: false,
      reason:
        "URL must not contain a userinfo component. Pass credentials via the auth header field instead.",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "") {
    return { ok: false, reason: "URL must have a hostname." };
  }

  // Hostname-string deny list (no DNS lookup for these).
  if (BLOCKED_EXACT_HOSTNAMES.has(hostname)) {
    return {
      ok: false,
      reason: `Hostname "${hostname}" is not allowed.`,
    };
  }
  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      return {
        ok: false,
        reason: `Hostnames ending in "${suffix}" are not allowed.`,
      };
    }
  }

  // Port whitelist. 80 and 443 always allowed; otherwise must be in the
  // unprivileged range 1024-65535. Most public MCP endpoints expose 443.
  if (parsed.port !== "") {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return { ok: false, reason: `Port "${parsed.port}" is invalid.` };
    }
    if (!ALLOWED_PORTS_LOW.has(portNum) && portNum < 1024) {
      return {
        ok: false,
        reason: `Port ${portNum} is reserved. Use 80, 443, or a port in 1024-65535.`,
      };
    }
  }

  // DNS resolution. Reject if any resolved address is in a private range.
  // Note: this is a single point-in-time resolution; DNS rebinding can
  // change the answer between validate and fetch. Document accordingly.
  let addresses: LookupAddress[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return {
      ok: false,
      reason: `Could not resolve hostname "${hostname}".`,
    };
  }

  if (addresses.length === 0) {
    return {
      ok: false,
      reason: `Hostname "${hostname}" resolved to no addresses.`,
    };
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) {
      return {
        ok: false,
        reason: `Hostname "${hostname}" resolves to a private IPv4 address (${address}).`,
      };
    }
    if (family === 6 && isPrivateIPv6(address)) {
      return {
        ok: false,
        reason: `Hostname "${hostname}" resolves to a private IPv6 address (${address}).`,
      };
    }
  }

  return { ok: true, parsedUrl: parsed };
}

/**
 * IPv4 private/reserved ranges per RFC 1918 / RFC 6890.
 * - 10.0.0.0/8
 * - 100.64.0.0/10 (CGNAT)
 * - 127.0.0.0/8 (loopback)
 * - 169.254.0.0/16 (link-local)
 * - 172.16.0.0/12
 * - 192.168.0.0/16
 * - 0.0.0.0/8 (unspecified / "this network")
 * - 224.0.0.0/4 (multicast)
 * - 240.0.0.0/4 (reserved future / broadcast)
 */
export function isPrivateIPv4(address: string): boolean {
  if (!net.isIPv4(address)) return false;
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) {
    return true; // malformed → treat as unsafe
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a >= 224) return true; // multicast + reserved
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/**
 * IPv6 private/reserved ranges.
 * - ::1 (loopback)
 * - ::/128 (unspecified)
 * - fc00::/7 (unique local)
 * - fe80::/10 (link-local)
 * - ff00::/8 (multicast)
 * - IPv4-mapped (::ffff:0:0/96) — re-check the embedded v4
 */
export function isPrivateIPv6(address: string): boolean {
  if (!net.isIPv6(address)) return false;
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9")) return true;
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (lower.startsWith("ff")) return true;
  // IPv4-mapped IPv6: ::ffff:1.2.3.4
  const v4MapMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MapMatch?.[1]) {
    return isPrivateIPv4(v4MapMatch[1]);
  }
  return false;
}
