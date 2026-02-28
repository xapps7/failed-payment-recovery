import fs from "node:fs";
import path from "node:path";
import { defaultRetryPolicy } from "../domain/retryPolicy";

export interface AppSettings {
  brandName: string;
  supportEmail: string;
  accentColor: string;
  sendEmail: boolean;
  sendSms: boolean;
  retryMinutes: number[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

const defaultSettings: AppSettings = {
  brandName: "Retryly",
  supportEmail: "support@example.com",
  accentColor: "#0f766e",
  sendEmail: true,
  sendSms: false,
  retryMinutes: defaultRetryPolicy.minutesAfterFailure
};

function ensureStore(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2), "utf8");
  }
}

export function readSettings(): AppSettings {
  ensureStore();
  const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
  return {
    ...defaultSettings,
    ...(JSON.parse(raw) as Partial<AppSettings>)
  };
}

export function writeSettings(next: Partial<AppSettings>): AppSettings {
  const merged = {
    ...readSettings(),
    ...next
  };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
