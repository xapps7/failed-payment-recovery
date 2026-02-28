import { getPrisma } from "../../db/prisma";
import { readSettings, writeSettings, type AppSettings } from "../settingsStore";

const DEFAULT_SHOP_DOMAIN = process.env.SHOP_DOMAIN || "default-shop";

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

export async function readAppSettings(): Promise<AppSettings> {
  const prisma = getPrisma();
  if (!prisma) return readSettings();

  const shopId = await ensureShopId(prisma);
  const row = await prisma.shopSetting.findUnique({ where: { shopId } });
  if (!row) {
    const current = readSettings();
    await prisma.shopSetting.create({
      data: {
        shopId,
        brandName: current.brandName,
        supportEmail: current.supportEmail,
        accentColor: current.accentColor,
        sendEmail: current.sendEmail,
        sendSms: current.sendSms,
        retryMinutes: current.retryMinutes
      }
    });
    return current;
  }

  return {
    brandName: row.brandName,
    supportEmail: row.supportEmail,
    accentColor: row.accentColor,
    sendEmail: row.sendEmail,
    sendSms: row.sendSms,
    retryMinutes: Array.isArray(row.retryMinutes) ? (row.retryMinutes as number[]) : [15, 360, 1440]
  };
}

export async function writeAppSettings(next: Partial<AppSettings>): Promise<AppSettings> {
  const prisma = getPrisma();
  if (!prisma) return writeSettings(next);

  const current = await readAppSettings();
  const merged = { ...current, ...next };
  const shopId = await ensureShopId(prisma);

  await prisma.shopSetting.upsert({
    where: { shopId },
    update: {
      brandName: merged.brandName,
      supportEmail: merged.supportEmail,
      accentColor: merged.accentColor,
      sendEmail: merged.sendEmail,
      sendSms: merged.sendSms,
      retryMinutes: merged.retryMinutes
    },
    create: {
      shopId,
      brandName: merged.brandName,
      supportEmail: merged.supportEmail,
      accentColor: merged.accentColor,
      sendEmail: merged.sendEmail,
      sendSms: merged.sendSms,
      retryMinutes: merged.retryMinutes
    }
  });

  writeSettings(merged);
  return merged;
}
