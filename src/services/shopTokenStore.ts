import fs from "node:fs";
import path from "node:path";

export interface ShopTokenRecord {
  shop: string;
  accessToken: string;
  scope: string;
  updatedAt: string;
}

interface TokenDb {
  shops: ShopTokenRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const TOKEN_DB_PATH = path.join(DATA_DIR, "shopTokens.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TOKEN_DB_PATH)) {
    fs.writeFileSync(TOKEN_DB_PATH, JSON.stringify({ shops: [] }, null, 2), "utf8");
  }
}

function readDb(): TokenDb {
  ensureDb();
  const raw = fs.readFileSync(TOKEN_DB_PATH, "utf8");
  return JSON.parse(raw) as TokenDb;
}

function writeDb(db: TokenDb): void {
  fs.writeFileSync(TOKEN_DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

export function saveShopToken(record: ShopTokenRecord): void {
  const db = readDb();
  const index = db.shops.findIndex((shop) => shop.shop === record.shop);

  if (index === -1) db.shops.push(record);
  else db.shops[index] = record;

  writeDb(db);
}

export function getShopToken(shop: string): ShopTokenRecord | undefined {
  const db = readDb();
  return db.shops.find((entry) => entry.shop === shop);
}

export function listShops(): ShopTokenRecord[] {
  const db = readDb();
  return db.shops;
}
