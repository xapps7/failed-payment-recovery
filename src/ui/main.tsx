import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
import { App } from "./App";

declare global {
  interface Window {
    __APP_CONFIG__?: {
      shopifyApiKey?: string;
      shop?: string;
      host?: string;
      embedded?: boolean;
    };
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <React.StrictMode>
    <AppProvider i18n={enTranslations}>
      <App />
    </AppProvider>
  </React.StrictMode>
);
