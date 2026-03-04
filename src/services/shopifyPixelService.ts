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
    reason: existingPixelId ? undefined : "No registered web pixel found"
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

  const response = await postAdminGraphql<{
    data?: {
      webPixelCreate?: {
        userErrors?: Array<{ message: string }>;
        webPixel?: { id: string };
      };
    };
  }>(
    shopDomain,
    accessToken,
    `
      mutation webPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          userErrors { message }
          webPixel { id }
        }
      }
    `,
    {
      webPixel: {
        settings
      }
    }
  ).catch((error) => ({
    data: {
      webPixelCreate: {
        userErrors: [{ message: error instanceof Error ? error.message : "Unknown error" }],
        webPixel: undefined
      }
    }
  }));

  const pixelPayload = response.data?.webPixelCreate;
  const pixel = pixelPayload?.webPixel;
  const errors = pixelPayload?.userErrors || [];
  if (!pixel || errors.length > 0) {
    return { activated: false, reason: errors[0]?.message || "Pixel activation failed" };
  }

  return {
    activated: true,
    pixelId: pixel.id
  };
}
