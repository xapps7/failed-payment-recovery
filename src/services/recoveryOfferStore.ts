import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface RecoveryOffer {
  checkoutToken: string;
  shopDomain: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  generatedAt: string;
}

interface OfferDb {
  offers: RecoveryOffer[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const OFFERS_PATH = path.join(DATA_DIR, "recoveryOffers.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(OFFERS_PATH)) {
    fs.writeFileSync(OFFERS_PATH, JSON.stringify({ offers: [] }, null, 2), "utf8");
  }
}

function readDb(): OfferDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(OFFERS_PATH, "utf8")) as OfferDb;
}

function writeDb(db: OfferDb): void {
  fs.writeFileSync(OFFERS_PATH, JSON.stringify(db, null, 2), "utf8");
}

function makeCode(type: "percentage" | "fixed", value: number): string {
  const prefix = type === "percentage" ? `SAVE${Math.round(value)}` : `OFF${Math.round(value)}`;
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${suffix}`;
}

export function getRecoveryOffer(checkoutToken: string, shopDomain: string): RecoveryOffer | undefined {
  const db = readDb();
  return db.offers.find((offer) => offer.checkoutToken === checkoutToken && offer.shopDomain === shopDomain);
}

export function getOrCreateRecoveryOffer(params: {
  checkoutToken: string;
  shopDomain: string;
  type: "percentage" | "fixed";
  value: number;
}): RecoveryOffer {
  const existing = getRecoveryOffer(params.checkoutToken, params.shopDomain);
  if (existing) return existing;

  const db = readDb();
  const created: RecoveryOffer = {
    checkoutToken: params.checkoutToken,
    shopDomain: params.shopDomain,
    code: makeCode(params.type, params.value),
    type: params.type,
    value: params.value,
    generatedAt: new Date().toISOString()
  };
  db.offers.push(created);
  writeDb(db);
  return created;
}
