import { appBaseUrl } from "../config/env";
import { getShopAdminToken, postAdminGraphql } from "./shopifyAdminApi";

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

  const existing = await postAdminGraphql<{
    data?: {
      webPixels?: {
        nodes?: Array<{ id: string }>;
      };
    };
  }>(
    shopDomain,
    accessToken,
    `
      query RetrylyWebPixels {
        webPixels(first: 10) {
          nodes { id }
        }
      }
    `
  ).catch(() => ({ data: { webPixels: { nodes: [] } } }));

  const existingPixelId = existing.data?.webPixels?.nodes?.[0]?.id;

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
