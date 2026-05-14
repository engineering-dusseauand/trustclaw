import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const users = await pool.query('SELECT id, username, email FROM "user"');
  console.log("Users:", users.rows);
  
  const accounts = await pool.query('SELECT id, "userId", "providerId", "accountId" FROM "account"');
  console.log("Accounts:", accounts.rows);
  
  await pool.end();
}

main().catch(console.error);
