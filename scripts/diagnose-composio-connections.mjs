import "dotenv/config";
import pg from "pg";
import { Composio } from "@composio/core";

const email = process.argv[2] ?? "mark@starterstack.ai";
const toolkitFilter = process.argv[3]?.toUpperCase();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const userRes = await client.query(
    `SELECT id, email, name FROM "user" WHERE email = $1 LIMIT 1`,
    [email],
  );
  if (userRes.rowCount === 0) {
    console.error(`No user found for email ${email}`);
    process.exit(1);
  }
  const user = userRes.rows[0];

  const instRes = await client.query(
    `SELECT id, "userId", "supabaseProjectRef" FROM composio_claw_instance WHERE "userId" = $1`,
    [user.id],
  );
  const instance = instRes.rows[0] ?? null;

  console.log("=== User identity ===");
  console.log(`email          : ${user.email}`);
  console.log(`user.id        : ${user.id}`);
  console.log(`instance.userId: ${instance?.userId ?? "(no instance)"}`);
  console.log(`matches?       : ${instance?.userId === user.id ? "YES" : "NO"}`);
  console.log(`pinnedSupabase : ${instance?.supabaseProjectRef ?? "(none)"}`);
  console.log("");

  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

  // Helper to find the user-id-like field on a connection row.
  // Composio's response field names have shifted across SDK versions.
  function findUserId(row) {
    const candidates = ["userId", "user_id", "user", "connectedUserId", "connected_user_id"];
    for (const k of candidates) {
      if (typeof row?.[k] === "string") return row[k];
    }
    // Also look one level down.
    for (const k of Object.keys(row ?? {})) {
      const v = row[k];
      if (v && typeof v === "object" && typeof v.id === "string" && k.toLowerCase().includes("user")) {
        return v.id;
      }
    }
    return null;
  }

  async function paginate(query) {
    const out = [];
    let cursor;
    let pages = 0;
    do {
      const page = await composio.connectedAccounts.list({ ...query, cursor });
      out.push(...(page.items ?? []));
      cursor = page.nextCursor ?? page.next_cursor ?? undefined;
      pages++;
      if (pages > 20) break; // safety
    } while (cursor);
    return out;
  }

  console.log("=== ALL Composio connected accounts (paginated) ===");
  const all = await paginate({});
  console.log(`Total connections in your Composio org: ${all.length}`);
  console.log("");

  console.log("=== Mine (userId === " + user.id + ") ===");
  const mine = all.filter((a) => findUserId(a) === user.id);
  if (mine.length === 0) console.log("(none)");
  for (const a of mine) {
    console.log(
      `- toolkit=${a.toolkit?.slug ?? "?"}  status=${a.status ?? "?"}  ` +
        `id=${a.id ?? "?"}  createdAt=${a.createdAt ?? a.created_at ?? "?"}`,
    );
  }
  console.log("");

  // What does session.toolkits() say? This is the source the UI reads.
  console.log("=== What session.toolkits() reports (the UI's source) ===");
  const session = await composio.create(user.id, {});
  const tk = await session.toolkits({
    toolkits: toolkitFilter ? [toolkitFilter.toLowerCase()] : ["github"],
  });
  for (const t of tk.items ?? []) {
    console.log(`- slug=${t.slug}  isActive=${t.connection?.isActive}  ` +
      `connection.id=${t.connection?.id ?? "(none)"}  ` +
      `connection.status=${t.connection?.status ?? "(none)"}`);
  }
  console.log("");

  if (toolkitFilter) {
    console.log(`=== ALL ${toolkitFilter} connections (any userId) ===`);
    const filtered = all.filter(
      (a) => a.toolkit?.slug?.toUpperCase() === toolkitFilter,
    );
    if (filtered.length === 0) console.log("(none)");
    for (const a of filtered) {
      const uid = findUserId(a);
      console.log(
        `- toolkit=${a.toolkit?.slug ?? "?"}  status=${a.status ?? "?"}  ` +
          `userId=${uid ?? "(unknown field)"}  ` +
          `${uid === user.id ? "(MINE)" : "(OTHER)"}  ` +
          `id=${a.id ?? "?"}  createdAt=${a.createdAt ?? a.created_at ?? "?"}`,
      );
    }
    console.log("");

    // Dump the raw shape of the first matching row so we can see what
    // field names Composio actually uses on connections in this SDK version.
    if (filtered[0]) {
      console.log("=== Raw shape of first matching row (top-level keys) ===");
      console.log(Object.keys(filtered[0]).join(", "));
      console.log("");
      console.log("=== Full JSON of first matching row ===");
      console.log(JSON.stringify(filtered[0], null, 2));
    }
  }
} finally {
  await client.end();
}
