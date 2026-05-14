import pg from "pg";
import * as crypto from "crypto";

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Better Auth uses scrypt for password hashing
async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

async function main() {
  const client = await pool.connect();
  
  try {
    // Delete existing user and related records
    await client.query(`DELETE FROM "account" WHERE "userId" IN (SELECT id FROM "user" WHERE username = 'mark')`);
    await client.query(`DELETE FROM "session" WHERE "userId" IN (SELECT id FROM "user" WHERE username = 'mark')`);
    await client.query(`DELETE FROM "user" WHERE username = 'mark'`);
    
    const hashedPassword = await hashPassword("Password,1906!");
    const userId = crypto.randomUUID();
    
    // Create user
    await client.query(`
      INSERT INTO "user" (id, email, name, username, "emailVerified", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, true, NOW(), NOW())
    `, [userId, "Mark@starterstack.ai", "Mark", "mark"]);
    
    // Create credential account with password
    await client.query(`
      INSERT INTO "account" (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'credential', $4, NOW(), NOW())
    `, [crypto.randomUUID(), userId, userId, hashedPassword]);
    
    console.log("User created successfully!");
    console.log("Username: mark");
    console.log("Password: Password,1906!");
    
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
