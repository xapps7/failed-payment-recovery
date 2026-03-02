import fs from "node:fs";
import path from "node:path";

export interface ProviderEventRecord {
  provider: "sendgrid" | "twilio";
  payload: unknown;
  receivedAt: string;
}

interface ProviderEventDb {
  events: ProviderEventRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const EVENTS_PATH = path.join(DATA_DIR, "providerEvents.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(EVENTS_PATH)) {
    fs.writeFileSync(EVENTS_PATH, JSON.stringify({ events: [] }, null, 2), "utf8");
  }
}

function readDb(): ProviderEventDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(EVENTS_PATH, "utf8")) as ProviderEventDb;
}

function writeDb(db: ProviderEventDb): void {
  fs.writeFileSync(EVENTS_PATH, JSON.stringify(db, null, 2), "utf8");
}

export function recordProviderEvent(provider: "sendgrid" | "twilio", payload: unknown): ProviderEventRecord {
  const db = readDb();
  const event: ProviderEventRecord = { provider, payload, receivedAt: new Date().toISOString() };
  db.events.push(event);
  writeDb(db);
  return event;
}
