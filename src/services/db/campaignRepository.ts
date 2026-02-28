import type { Prisma } from "@prisma/client";
import { getPrisma } from "../../db/prisma";
import {
  getActiveCampaign as getFileActiveCampaign,
  listCampaigns as listFileCampaigns,
  saveCampaign as saveFileCampaign,
  setCampaignStatus as setFileCampaignStatus,
  type RecoveryCampaign
} from "../campaignStore";

const DEFAULT_SHOP_DOMAIN = process.env.SHOP_DOMAIN || "default-shop";

type CampaignWithSteps = Prisma.RecoveryCampaignGetPayload<{
  include: { steps: true };
}>;

function normalizeCampaign(campaign: CampaignWithSteps): RecoveryCampaign {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    priority: campaign.priority,
    isDefault: campaign.isDefault,
    rules: {
      minimumOrderValue: campaign.minimumOrderValue,
      customerSegment: campaign.customerSegment,
      includeCountries: Array.isArray(campaign.includeCountries) ? (campaign.includeCountries as string[]) : [],
      quietHoursStart: campaign.quietHoursStart,
      quietHoursEnd: campaign.quietHoursEnd
    },
    steps: campaign.steps
      .sort((a, b) => a.sequence - b.sequence)
      .map((step) => ({
        id: step.id,
        delayMinutes: step.delayMinutes,
        channel: step.channel,
        tone: step.tone,
        stopIfPurchased: step.stopIfPurchased
      })),
    theme: {
      headline: campaign.headline,
      body: campaign.body,
      sms: campaign.sms
    }
  };
}

async function ensureShopId(prisma: NonNullable<ReturnType<typeof getPrisma>>): Promise<string> {
  const shop = await prisma.shop.upsert({
    where: { domain: DEFAULT_SHOP_DOMAIN },
    update: {},
    create: {
      domain: DEFAULT_SHOP_DOMAIN,
      accessToken: "",
      grantedScope: null
    }
  });
  return shop.id;
}

async function seedFromFile(prisma: NonNullable<ReturnType<typeof getPrisma>>): Promise<void> {
  const existing = await prisma.recoveryCampaign.count();
  if (existing > 0) return;

  const shopId = await ensureShopId(prisma);
  const fileCampaigns = listFileCampaigns();
  for (const campaign of fileCampaigns) {
    await prisma.recoveryCampaign.create({
      data: {
        id: campaign.id,
        shopId,
        name: campaign.name,
        status: campaign.status,
        priority: campaign.priority,
        isDefault: campaign.isDefault,
        minimumOrderValue: campaign.rules.minimumOrderValue,
        customerSegment: campaign.rules.customerSegment,
        includeCountries: campaign.rules.includeCountries,
        quietHoursStart: campaign.rules.quietHoursStart,
        quietHoursEnd: campaign.rules.quietHoursEnd,
        headline: campaign.theme.headline,
        body: campaign.theme.body,
        sms: campaign.theme.sms,
        steps: {
          create: campaign.steps.map((step, index) => ({
            id: step.id,
            sequence: index,
            delayMinutes: step.delayMinutes,
            channel: step.channel,
            tone: step.tone,
            stopIfPurchased: step.stopIfPurchased
          }))
        }
      }
    });
  }
}

export async function listRecoveryCampaigns(): Promise<RecoveryCampaign[]> {
  const prisma = getPrisma();
  if (!prisma) return listFileCampaigns();

  await seedFromFile(prisma);
  const campaigns = await prisma.recoveryCampaign.findMany({
    include: { steps: true },
    orderBy: { priority: "asc" }
  });

  return campaigns.map(normalizeCampaign);
}

export async function getCurrentCampaign(): Promise<RecoveryCampaign> {
  const prisma = getPrisma();
  if (!prisma) return getFileActiveCampaign();

  const campaigns = await listRecoveryCampaigns();
  return campaigns.find((campaign) => campaign.status === "ACTIVE") || campaigns[0];
}

export async function saveRecoveryCampaign(input: RecoveryCampaign): Promise<RecoveryCampaign> {
  const prisma = getPrisma();
  saveFileCampaign(input);
  if (!prisma) return input;

  const shopId = await ensureShopId(prisma);
  await prisma.recoveryCampaign.upsert({
    where: { id: input.id },
    update: {
      name: input.name,
      status: input.status,
      priority: input.priority,
      isDefault: input.isDefault,
      minimumOrderValue: input.rules.minimumOrderValue,
      customerSegment: input.rules.customerSegment,
      includeCountries: input.rules.includeCountries,
      quietHoursStart: input.rules.quietHoursStart,
      quietHoursEnd: input.rules.quietHoursEnd,
      headline: input.theme.headline,
      body: input.theme.body,
      sms: input.theme.sms,
      steps: {
        deleteMany: {},
        create: input.steps.map((step, index) => ({
          id: step.id,
          sequence: index,
          delayMinutes: step.delayMinutes,
          channel: step.channel,
          tone: step.tone,
          stopIfPurchased: step.stopIfPurchased
        }))
      }
    },
    create: {
      id: input.id,
      shopId,
      name: input.name,
      status: input.status,
      priority: input.priority,
      isDefault: input.isDefault,
      minimumOrderValue: input.rules.minimumOrderValue,
      customerSegment: input.rules.customerSegment,
      includeCountries: input.rules.includeCountries,
      quietHoursStart: input.rules.quietHoursStart,
      quietHoursEnd: input.rules.quietHoursEnd,
      headline: input.theme.headline,
      body: input.theme.body,
      sms: input.theme.sms,
      steps: {
        create: input.steps.map((step, index) => ({
          id: step.id,
          sequence: index,
          delayMinutes: step.delayMinutes,
          channel: step.channel,
          tone: step.tone,
          stopIfPurchased: step.stopIfPurchased
        }))
      }
    }
  });

  if (input.status === "ACTIVE") {
    await prisma.recoveryCampaign.updateMany({
      where: { shopId, NOT: { id: input.id }, status: "ACTIVE" },
      data: { status: "PAUSED" }
    });
  }

  return input;
}

export async function updateRecoveryCampaignStatus(
  id: string,
  status: RecoveryCampaign["status"]
): Promise<RecoveryCampaign | undefined> {
  const prisma = getPrisma();
  const fileUpdated = setFileCampaignStatus(id, status);
  if (!prisma) return fileUpdated;

  const campaign = await prisma.recoveryCampaign.findUnique({ where: { id }, include: { steps: true } });
  if (!campaign) return fileUpdated;

  if (status === "ACTIVE") {
    await prisma.recoveryCampaign.updateMany({
      where: { shopId: campaign.shopId, NOT: { id }, status: "ACTIVE" },
      data: { status: "PAUSED" }
    });
  }

  const updated = await prisma.recoveryCampaign.update({
    where: { id },
    data: { status },
    include: { steps: true }
  });

  return normalizeCampaign(updated);
}
