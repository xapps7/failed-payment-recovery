import fs from "node:fs";
import path from "node:path";

export interface DiscountSyncRecord {
  checkoutToken: string;
  shopDomain: string;
  status: "synced" | "failed";
  reason?: string;
  updatedAt: string;
}

interface DiscountSyncDb {
  records: DiscountSyncRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const SYNC_PATH = path.join(DATA_DIR, "discountSync.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SYNC_PATH)) {
    fs.writeFileSync(SYNC_PATH, JSON.stringify({ records: [] }, null, 2), "utf8");
  }
}

function readDb(): DiscountSyncDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(SYNC_PATH, "utf8")) as DiscountSyncDb;
}

function writeDb(db: DiscountSyncDb): void {
  fs.writeFileSync(SYNC_PATH, JSON.stringify(db, null, 2), "utf8");
}

export function saveDiscountSync(input: Omit<DiscountSyncRecord, "updatedAt">): DiscountSyncRecord {
  const db = readDb();
  const existing = db.records.find((record) => record.checkoutToken === input.checkoutToken && record.shopDomain === input.shopDomain);
  const updated: DiscountSyncRecord = { ...input, updatedAt: new Date().toISOString() };
  if (existing) {
    existing.status = updated.status;
    existing.reason = updated.reason;
    existing.updatedAt = updated.updatedAt;
  } else {
    db.records.push(updated);
  }
  writeDb(db);
  return updated;
}

export function getDiscountSync(checkoutToken: string, shopDomain: string): DiscountSyncRecord | undefined {
  return readDb().records.find((record) => record.checkoutToken === checkoutToken && record.shopDomain === shopDomain);
}
