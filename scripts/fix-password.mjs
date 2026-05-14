import { Pool } from "pg";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

// Better Auth's password hashing format
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  
  const password = "Password,1906!";
  const hashedPassword = await hashPassword(password);
  
  console.log("New hashed password format:", hashedPassword.substring(0, 50) + "...");
  
  // Update the account with the correct password hash
  const result = await pool.query(
    `UPDATE account SET password = $1 WHERE "providerId" = 'credential' RETURNING id, "userId"`,
    [hashedPassword]
  );
  
  console.log("Updated accounts:", result.rows);
  
  await pool.end();
}

main().catch(console.error);
