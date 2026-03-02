import fs from "node:fs";
import path from "node:path";

export interface RecoveryLineItem {
  variantId: string;
  quantity: number;
  title?: string;
}

export interface RecoveryPayload {
  checkoutToken: string;
  shopDomain: string;
  checkoutUrl?: string;
  cartUrl?: string;
  lineItems: RecoveryLineItem[];
  currencyCode?: string;
  paymentMethod?: string;
  paymentFailureLabel?: string;
  updatedAt: string;
}

interface RecoveryPayloadDb {
  payloads: RecoveryPayload[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const PAYLOAD_PATH = path.join(DATA_DIR, "recoveryPayloads.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PAYLOAD_PATH)) {
    fs.writeFileSync(PAYLOAD_PATH, JSON.stringify({ payloads: [] }, null, 2), "utf8");
  }
}

function readDb(): RecoveryPayloadDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(PAYLOAD_PATH, "utf8")) as RecoveryPayloadDb;
}

function writeDb(db: RecoveryPayloadDb): void {
  fs.writeFileSync(PAYLOAD_PATH, JSON.stringify(db, null, 2), "utf8");
}

function keyMatches(a: RecoveryPayload, checkoutToken: string, shopDomain: string): boolean {
  return a.checkoutToken === checkoutToken && a.shopDomain === shopDomain;
}

export function saveRecoveryPayload(payload: RecoveryPayload): RecoveryPayload {
  const db = readDb();
  const index = db.payloads.findIndex((entry) => keyMatches(entry, payload.checkoutToken, payload.shopDomain));
  if (index === -1) db.payloads.push(payload);
  else db.payloads[index] = payload;
  writeDb(db);
  return payload;
}

export function getRecoveryPayload(checkoutToken: string, shopDomain: string): RecoveryPayload | undefined {
  return readDb().payloads.find((entry) => keyMatches(entry, checkoutToken, shopDomain));
}
