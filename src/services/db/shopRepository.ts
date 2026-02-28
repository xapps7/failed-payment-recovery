import { getPrisma } from "../../db/prisma";
import { getShopToken, listShops, saveShopToken, type ShopTokenRecord } from "../shopTokenStore";

export async function upsertShopToken(record: ShopTokenRecord): Promise<void> {
  const prisma = getPrisma();
  saveShopToken(record);
  if (!prisma) return;

  await prisma.shop.upsert({
    where: { domain: record.shop },
    update: {
      accessToken: record.accessToken,
      grantedScope: record.scope || null
    },
    create: {
      domain: record.shop,
      accessToken: record.accessToken,
      grantedScope: record.scope || null
    }
  });
}

export async function listShopTokens(): Promise<ShopTokenRecord[]> {
  const prisma = getPrisma();
  if (!prisma) return listShops();

  const shops = await prisma.shop.findMany({ orderBy: { updatedAt: "desc" } });
  return shops.map((shop) => ({
    shop: shop.domain,
    accessToken: shop.accessToken,
    scope: shop.grantedScope || "",
    updatedAt: shop.updatedAt.toISOString()
  }));
}

export async function findShopToken(shopDomain: string): Promise<ShopTokenRecord | undefined> {
  const prisma = getPrisma();
  if (!prisma) return getShopToken(shopDomain);

  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return undefined;
  return {
    shop: shop.domain,
    accessToken: shop.accessToken,
    scope: shop.grantedScope || "",
    updatedAt: shop.updatedAt.toISOString()
  };
}
