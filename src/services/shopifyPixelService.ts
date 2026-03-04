import { appBaseUrl } from "../config/env";
import { getShopAdminToken, postAdminGraphql } from "./shopifyAdminApi";

export async function getShopifyWebPixelStatus(
  shopDomain: string
): Promise<{ active: boolean; pixelId?: string; reason?: string }> {
  const accessToken = await getShopAdminToken(shopDomain);
  if (!accessToken) {
    return { active: false, reason: "Missing shop access token" };
  }

  const existing = await postAdminGraphql<{
    data?: {
      webPixel?: { id: string };
    };
  }>(
    shopDomain,
    accessToken,
    `
      query RetrylyWebPixel {
        webPixel {
          id
        }
      }
    `
  ).catch(() => ({ data: { webPixel: undefined } }));

  const existingPixelId = existing.data?.webPixel?.id;
  return {
    active: Boolean(existingPixelId),
    pixelId: existingPixelId,
    reason: existingPixelId
      ? undefined
      : "No registered app web pixel found. Deploy the Shopify app version with the web pixel extension, reinstall the app, then register the pixel."
  };
}

export async function activateShopifyWebPixel(
  shopDomain: string
): Promise<{ activated: boolean; reason?: string; pixelId?: string }> {
  const accessToken = await getShopAdminToken(shopDomain);
  if (!accessToken) {
    return { activated: false, reason: "Missing shop access token" };
  }

  const settings = JSON.stringify({
    endpoint: `${appBaseUrl()}/events/web-pixel`,
    shopDomain
  });

  const existingStatus = await getShopifyWebPixelStatus(shopDomain);
  const existingPixelId = existingStatus.pixelId;

  if (existingPixelId) {
    const updateResponse = await postAdminGraphql<{
      data?: {
        webPixelUpdate?: {
          userErrors?: Array<{ message: string }>;
          webPixel?: { id: string };
        };
      };
    }>(
      shopDomain,
      accessToken,
      `
        mutation webPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
          webPixelUpdate(id: $id, webPixel: $webPixel) {
            userErrors { message }
            webPixel { id }
          }
        }
      `,
      {
        id: existingPixelId,
        webPixel: { settings }
      }
    ).catch((error) => ({
      data: {
        webPixelUpdate: {
          userErrors: [{ message: error instanceof Error ? error.message : "Unknown error" }],
          webPixel: undefined
        }
      }
    }));

    const updatePayload = updateResponse.data?.webPixelUpdate;
    const updatePixel = updatePayload?.webPixel;
    const updateErrors = updatePayload?.userErrors || [];
    if (updatePixel && updateErrors.length === 0) {
      return {
        activated: true,
        pixelId: updatePixel.id
      };
    }
  }
  return {
    activated: false,
    reason: "App web pixel is not registered in this store. Re-deploy the Shopify app version with the web pixel extension and reinstall the app, then re-activate."
  };
}
