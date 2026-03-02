declare module "@shopify/web-pixels-extension" {
  export function register(
    handler: (api: {
      analytics: { subscribe: (eventName: string, callback: (event: unknown) => void | Promise<void>) => void };
      browser: { location: { hostname: string } };
      settings: Record<string, unknown>;
    }) => void
  ): void;
}
