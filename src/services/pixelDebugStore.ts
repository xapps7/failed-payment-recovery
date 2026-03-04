import fs from "node:fs";
import path from "node:path";

export interface PixelDebugRecord {
  receivedAt: string;
  kind: "accepted" | "rejected";
  eventName?: string;
  payload: unknown;
  reason?: string;
}

interface PixelDebugDb {
  events: PixelDebugRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const DEBUG_PATH = path.join(DATA_DIR, "pixelDebug.json");

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DEBUG_PATH)) {
    fs.writeFileSync(DEBUG_PATH, JSON.stringify({ events: [] }, null, 2), "utf8");
  }
}

function readDb(): PixelDebugDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(DEBUG_PATH, "utf8")) as PixelDebugDb;
}

function writeDb(db: PixelDebugDb): void {
  fs.writeFileSync(DEBUG_PATH, JSON.stringify(db, null, 2), "utf8");
}

export function recordPixelDebug(event: Omit<PixelDebugRecord, "receivedAt">): PixelDebugRecord {
  const db = readDb();
  const record: PixelDebugRecord = {
    receivedAt: new Date().toISOString(),
    ...event
  };
  db.events.push(record);
  db.events = db.events.slice(-50);
  writeDb(db);
  return record;
}

export function listPixelDebugEvents(limit = 20): PixelDebugRecord[] {
  return readDb().events.slice(-limit).reverse();
}
