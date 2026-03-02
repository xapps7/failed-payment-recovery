import fs from "node:fs";
import path from "node:path";

export interface DeliveryStatusRecord {
  checkoutToken: string;
  shopDomain: string;
  emailStatus?: string;
  smsStatus?: string;
  updatedAt: string;
}

interface DeliveryStatusDb {
  records: DeliveryStatusRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const STATUS_PATH = path.join(DATA_DIR, "deliveryStatuses.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATUS_PATH)) {
    fs.writeFileSync(STATUS_PATH, JSON.stringify({ records: [] }, null, 2), "utf8");
  }
}

function readDb(): DeliveryStatusDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")) as DeliveryStatusDb;
}

function writeDb(db: DeliveryStatusDb): void {
  fs.writeFileSync(STATUS_PATH, JSON.stringify(db, null, 2), "utf8");
}

export function saveDeliveryStatus(input: {
  checkoutToken: string;
  shopDomain: string;
  channel: "email" | "sms";
  status: string;
}): DeliveryStatusRecord {
  const db = readDb();
  let record = db.records.find((entry) => entry.checkoutToken === input.checkoutToken && entry.shopDomain === input.shopDomain);
  if (!record) {
    record = { checkoutToken: input.checkoutToken, shopDomain: input.shopDomain, updatedAt: new Date().toISOString() };
    db.records.push(record);
  }
  if (input.channel === "email") record.emailStatus = input.status;
  if (input.channel === "sms") record.smsStatus = input.status;
  record.updatedAt = new Date().toISOString();
  writeDb(db);
  return record;
}

export function getDeliveryStatus(checkoutToken: string, shopDomain: string): DeliveryStatusRecord | undefined {
  return readDb().records.find((entry) => entry.checkoutToken === checkoutToken && entry.shopDomain === shopDomain);
}
