import fs from "node:fs";
import path from "node:path";

export type OutreachAction = "mark_contacted" | "escalate_support";

export interface OperatorActionRecord {
  checkoutToken: string;
  shopDomain: string;
  lastAction: OutreachAction;
  actionHistory: Array<{ action: OutreachAction; at: string }>;
}

interface ActionDb {
  records: OperatorActionRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const ACTIONS_PATH = path.join(DATA_DIR, "operatorActions.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ACTIONS_PATH)) {
    fs.writeFileSync(ACTIONS_PATH, JSON.stringify({ records: [] }, null, 2), "utf8");
  }
}

function readDb(): ActionDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(ACTIONS_PATH, "utf8")) as ActionDb;
}

function writeDb(db: ActionDb): void {
  fs.writeFileSync(ACTIONS_PATH, JSON.stringify(db, null, 2), "utf8");
}

export function getOperatorAction(checkoutToken: string, shopDomain: string): OperatorActionRecord | undefined {
  return readDb().records.find((record) => record.checkoutToken === checkoutToken && record.shopDomain === shopDomain);
}

export function saveOperatorAction(
  checkoutToken: string,
  shopDomain: string,
  action: OutreachAction
): OperatorActionRecord {
  const db = readDb();
  const existing = db.records.find((record) => record.checkoutToken === checkoutToken && record.shopDomain === shopDomain);
  const event = { action, at: new Date().toISOString() };

  if (existing) {
    existing.lastAction = action;
    existing.actionHistory.push(event);
    writeDb(db);
    return existing;
  }

  const created: OperatorActionRecord = {
    checkoutToken,
    shopDomain,
    lastAction: action,
    actionHistory: [event]
  };
  db.records.push(created);
  writeDb(db);
  return created;
}
