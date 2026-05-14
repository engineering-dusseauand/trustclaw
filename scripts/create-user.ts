import { db } from "../src/server/clients/db";
import { hash } from "bcryptjs";

async function createUser() {
  const email = "Mark@starterstack.ai";
  const username = "mark";
  const password = "Password,1906!";
  const name = "Mark";

  const hashedPassword = await hash(password, 10);

  const user = await db.user.create({
    data: {
      email,
      name,
      username,
      emailVerified: true,
    },
  });

  await db.account.create({
    data: {
      userId: user.id,
      accountId: user.id,
      providerId: "credential",
      password: hashedPassword,
    },
  });

  console.log("User created:", user.email);
  process.exit(0);
}

createUser().catch((e) => {
  console.error(e);
  process.exit(1);
});
