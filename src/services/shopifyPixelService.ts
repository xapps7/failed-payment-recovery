import { appBaseUrl } from "../config/env";
import { getShopAdminToken, postAdminGraphql } from "./shopifyAdminApi";

export async function activateShopifyWebPixel(
  shopDomain: string
): Promise<{ activated: boolean; reason?: string; pixelId?: string }> {
  const accessToken = await getShopAdminToken(shopDomain);
  if (!accessToken) {
    return { activated: false, reason: "Missing shop access token" };
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
        settings: JSON.stringify({
          endpoint: `${appBaseUrl()}/events/web-pixel`,
          shopDomain
        })
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
