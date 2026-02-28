import { PrismaClient } from "@prisma/client";

let prismaSingleton: PrismaClient | null = null;

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPrisma(): PrismaClient | null {
  if (!hasDatabaseUrl()) return null;
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}
