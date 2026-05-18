import "dotenv/config";
import pg from "pg";

const email = process.argv[2] ?? "mark@starterstack.ai";
const limit = Number(process.argv[3] ?? 6);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const userRes = await client.query(
    `SELECT id, email FROM "user" WHERE email = $1 LIMIT 1`,
    [email],
  );
  if (userRes.rowCount === 0) {
    console.error(`No user for ${email}`);
    process.exit(1);
  }
  const user = userRes.rows[0];

  const instRes = await client.query(
    `SELECT id, "pinnedGithubRepos", "supabaseProjectRef", "allowDestructiveGithubActions" FROM composio_claw_instance WHERE "userId" = $1`,
    [user.id],
  );
  const instance = instRes.rows[0];
  console.log("=== Instance ===");
  console.log(`pinnedGithubRepos       : ${JSON.stringify(instance?.pinnedGithubRepos)}`);
  console.log(`supabaseProjectRef      : ${instance?.supabaseProjectRef}`);
  console.log(`allowDestructiveActions : ${instance?.allowDestructiveGithubActions}`);
  console.log("");

  const msgRes = await client.query(
    `SELECT id, role, "createdAt", content
     FROM composio_claw_message
     WHERE "instanceId" = $1
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    [instance.id, limit],
  );

  console.log(`=== Last ${msgRes.rowCount} messages (newest first) ===\n`);
  for (const m of msgRes.rows) {
    const ts = new Date(m.createdAt).toISOString();
    console.log(`--- [${ts}] ${m.role} (${m.id}) ---`);
    const parts = Array.isArray(m.content) ? m.content : [];
    for (const p of parts) {
      if (p.type === "text") {
        const text = String(p.text ?? "").slice(0, 500);
        console.log(`TEXT: ${text}${text.length === 500 ? "...[truncated]" : ""}`);
      } else if (p.type === "dynamic-tool" || (p.type ?? "").startsWith("tool-")) {
        const toolName = p.toolName ?? p.type;
        const inputStr = JSON.stringify(p.input ?? {}, null, 0).slice(0, 200);
        const outputStr = JSON.stringify(p.output ?? {}, null, 0).slice(0, 400);
        console.log(`TOOL: ${toolName}`);
        console.log(`  in:  ${inputStr}`);
        console.log(`  out: ${outputStr}${outputStr.length === 400 ? "...[truncated]" : ""}`);
      } else {
        console.log(`PART(${p.type}): ${JSON.stringify(p).slice(0, 200)}`);
      }
    }
    console.log("");
  }
} finally {
  await client.end();
}
