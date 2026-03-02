import fs from "node:fs";
import path from "node:path";

export interface SessionEngagement {
  checkoutToken: string;
  shopDomain: string;
  opens: number;
  clicks: number;
  lastOpenedAt?: string;
  lastClickedAt?: string;
}

interface EngagementDb {
  records: SessionEngagement[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const ENGAGEMENT_PATH = path.join(DATA_DIR, "engagement.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ENGAGEMENT_PATH)) {
    fs.writeFileSync(ENGAGEMENT_PATH, JSON.stringify({ records: [] }, null, 2), "utf8");
  }
}

function readDb(): EngagementDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(ENGAGEMENT_PATH, "utf8")) as EngagementDb;
}

function writeDb(db: EngagementDb): void {
  fs.writeFileSync(ENGAGEMENT_PATH, JSON.stringify(db, null, 2), "utf8");
}

function upsert(checkoutToken: string, shopDomain: string): { db: EngagementDb; record: SessionEngagement } {
  const db = readDb();
  let record = db.records.find((entry) => entry.checkoutToken === checkoutToken && entry.shopDomain === shopDomain);
  if (!record) {
    record = { checkoutToken, shopDomain, opens: 0, clicks: 0 };
    db.records.push(record);
  }
  return { db, record };
}

export function recordOpen(checkoutToken: string, shopDomain: string): SessionEngagement {
  const { db, record } = upsert(checkoutToken, shopDomain);
  record.opens += 1;
  record.lastOpenedAt = new Date().toISOString();
  writeDb(db);
  return record;
}

export function recordClick(checkoutToken: string, shopDomain: string): SessionEngagement {
  const { db, record } = upsert(checkoutToken, shopDomain);
  record.clicks += 1;
  record.lastClickedAt = new Date().toISOString();
  writeDb(db);
  return record;
}

export function getEngagement(checkoutToken: string, shopDomain: string): SessionEngagement | undefined {
  return readDb().records.find((entry) => entry.checkoutToken === checkoutToken && entry.shopDomain === shopDomain);
}
