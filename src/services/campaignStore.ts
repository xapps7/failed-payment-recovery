import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type RecoveryChannel = "email" | "sms";
export type CustomerSegment = "all" | "new" | "returning" | "vip";
export type CampaignTone = "steady" | "urgent" | "concierge" | "rescue";

export interface CampaignStep {
  id: string;
  delayMinutes: number;
  channel: RecoveryChannel;
  tone: CampaignTone;
  stopIfPurchased: boolean;
}

export interface CampaignRuleSet {
  minimumOrderValue: number;
  customerSegment: CustomerSegment;
  includeCountries: string[];
  quietHoursStart: number;
  quietHoursEnd: number;
}

export interface CampaignTheme {
  headline: string;
  body: string;
  sms: string;
}

export interface RecoveryCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "DRAFT" | "PAUSED";
  priority: number;
  isDefault: boolean;
  rules: CampaignRuleSet;
  steps: CampaignStep[];
  theme: CampaignTheme;
}

interface CampaignDb {
  campaigns: RecoveryCampaign[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const CAMPAIGNS_PATH = path.join(DATA_DIR, "campaigns.json");

function createDefaultCampaigns(): RecoveryCampaign[] {
  return [
    {
      id: randomUUID(),
      name: "Core Recovery",
      status: "ACTIVE",
      priority: 1,
      isDefault: true,
      rules: {
        minimumOrderValue: 0,
        customerSegment: "all",
        includeCountries: [],
        quietHoursStart: 22,
        quietHoursEnd: 8
      },
      steps: [
        { id: randomUUID(), delayMinutes: 15, channel: "email", tone: "steady", stopIfPurchased: true },
        { id: randomUUID(), delayMinutes: 360, channel: "email", tone: "urgent", stopIfPurchased: true },
        { id: randomUUID(), delayMinutes: 1440, channel: "sms", tone: "rescue", stopIfPurchased: true }
      ],
      theme: {
        headline: "Complete your purchase before your cart expires.",
        body: "Your payment did not go through. Use the secure link below to resume checkout and finish your order.",
        sms: "Your payment did not go through. Resume checkout here: {{retryUrl}}"
      }
    },
    {
      id: randomUUID(),
      name: "VIP Rescue",
      status: "DRAFT",
      priority: 2,
      isDefault: false,
      rules: {
        minimumOrderValue: 250,
        customerSegment: "vip",
        includeCountries: ["US", "CA", "GB"],
        quietHoursStart: 21,
        quietHoursEnd: 9
      },
      steps: [
        { id: randomUUID(), delayMinutes: 10, channel: "email", tone: "concierge", stopIfPurchased: true },
        { id: randomUUID(), delayMinutes: 180, channel: "sms", tone: "concierge", stopIfPurchased: true }
      ],
      theme: {
        headline: "We saved your order so you can finish in one click.",
        body: "A quick payment issue interrupted checkout. Use your secure link and we will restore your order immediately.",
        sms: "We saved your order. Resume securely: {{retryUrl}}"
      }
    }
  ];
}

function ensureDb(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CAMPAIGNS_PATH)) {
    fs.writeFileSync(CAMPAIGNS_PATH, JSON.stringify({ campaigns: createDefaultCampaigns() }, null, 2), "utf8");
  }
}

function readDb(): CampaignDb {
  ensureDb();
  return JSON.parse(fs.readFileSync(CAMPAIGNS_PATH, "utf8")) as CampaignDb;
}

function writeDb(db: CampaignDb): void {
  fs.writeFileSync(CAMPAIGNS_PATH, JSON.stringify(db, null, 2), "utf8");
}

export function listCampaigns(): RecoveryCampaign[] {
  return readDb().campaigns.sort((a, b) => a.priority - b.priority);
}

export function getActiveCampaign(): RecoveryCampaign {
  const campaigns = listCampaigns();
  return campaigns.find((campaign) => campaign.status === "ACTIVE") || campaigns[0];
}

export function saveCampaign(input: RecoveryCampaign): RecoveryCampaign {
  const db = readDb();
  const index = db.campaigns.findIndex((campaign) => campaign.id === input.id);
  if (index === -1) db.campaigns.push(input);
  else db.campaigns[index] = input;

  if (input.status === "ACTIVE") {
    db.campaigns = db.campaigns.map((campaign) =>
      campaign.id === input.id ? campaign : { ...campaign, status: campaign.status === "ACTIVE" ? "PAUSED" : campaign.status }
    );
  }

  writeDb(db);
  return input;
}

export function setCampaignStatus(id: string, status: RecoveryCampaign["status"]): RecoveryCampaign | undefined {
  const db = readDb();
  const target = db.campaigns.find((campaign) => campaign.id === id);
  if (!target) return undefined;

  target.status = status;
  if (status === "ACTIVE") {
    for (const campaign of db.campaigns) {
      if (campaign.id !== id && campaign.status === "ACTIVE") campaign.status = "PAUSED";
    }
  }

  writeDb(db);
  return target;
}
