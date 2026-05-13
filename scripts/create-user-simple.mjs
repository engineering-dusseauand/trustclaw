import { PrismaClient } from "@prisma/client";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scryptAsync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function main() {
  const prisma = new PrismaClient();
  
  try {
    const hashedPassword = await hashPassword("Password,1906!");
    
    const user = await prisma.user.create({
      data: {
        id: randomBytes(16).toString("hex"),
        email: "Mark@starterstack.ai",
        name: "Mark",
        username: "mark",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await prisma.account.create({
      data: {
        id: randomBytes(16).toString("hex"),
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    console.log("✅ User created successfully!");
    console.log("   Email: Mark@starterstack.ai");
    console.log("   Username: mark");
  } catch (error) {
    if (error.code === "P2002") {
      console.log("User already exists!");
    } else {
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
