import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  Divider,
  IndexTable,
  InlineStack,
  Layout,
  LegacyTabs,
  Page,
  Select,
  Text,
  TextField,
  Tooltip
} from "@shopify/polaris";
import "./styles.css";

type SessionState = "LIKELY_FAILED_PAYMENT" | "RECOVERED" | "EXPIRED" | "UNSUBSCRIBED" | "PENDING";
type CampaignStatus = "ACTIVE" | "DRAFT" | "PAUSED";
type CampaignTone = "steady" | "urgent" | "concierge" | "rescue";
type CampaignChannel = "email" | "sms";
type AppSection = "overview" | "campaigns" | "feed" | "settings";

type PlatformPayload = {
  commandCenter: {
    detected: number;
    recovered: number;
    expired: number;
    active: number;
    recoveredRevenue: number;
    pendingRevenue: number;
    recoveryRate: number;
  };
  settings: {
    brandName: string;
    supportEmail: string;
    accentColor: string;
    sendEmail: boolean;
    sendSms: boolean;
    retryMinutes: number[];
  };
  campaigns: Array<{
    id: string;
    name: string;
    status: CampaignStatus;
    priority: number;
    isDefault: boolean;
    rules: {
      minimumOrderValue: number;
      customerSegment: "all" | "new" | "returning" | "vip";
      includeCountries: string[];
      paymentMethods: string[];
      quietHoursStart: number;
      quietHoursEnd: number;
    };
    steps: Array<{
      id: string;
      delayMinutes: number;
      channel: CampaignChannel;
      tone: CampaignTone;
      stopIfPurchased: boolean;
    }>;
    theme: {
      headline: string;
      body: string;
      sms: string;
    };
    experience: {
      destination: "checkout" | "cart" | "support";
      discountAfterAttempt: number | null;
      discountType: "percentage" | "fixed";
      discountValue: number;
      directContactAfterAttempt: number | null;
      allowAgentEscalation: boolean;
    };
  }>;
  sessions: Array<{
    id: string;
    campaignId?: string;
    campaignName: string;
    shopDomain: string;
    checkoutToken: string;
    email?: string;
    phone?: string;
    amountSubtotal?: number;
    countryCode?: string;
    customerSegment?: "all" | "new" | "returning" | "vip";
    paymentMethod?: string;
    state: SessionState;
    attemptCount: number;
    failedAt?: string;
    nextAttemptAt?: string;
    operatorAction?: {
      lastAction: "mark_contacted" | "escalate_support";
      actionHistory: Array<{ action: "mark_contacted" | "escalate_support"; at: string }>;
    };
    offer?: {
      code: string;
      type: "percentage" | "fixed";
      value: number;
    };
    engagement?: {
      opens: number;
      clicks: number;
      lastOpenedAt?: string;
      lastClickedAt?: string;
    };
    deliveryStatus?: {
      emailStatus?: string;
      smsStatus?: string;
      updatedAt: string;
    };
    discountSync?: {
      status: "synced" | "failed";
      reason?: string;
      updatedAt: string;
    };
    retryStrategy?: string;
    recommendedPaymentOptions?: string[];
  }>;
  insights: {
    activeCampaign: string;
    channelMix: { email: number; sms: number };
    highestPriorityCampaign: string | null;
    countriesCovered: string[];
  };
};

const emptyPayload: PlatformPayload = {
  commandCenter: {
    detected: 0,
    recovered: 0,
    expired: 0,
    active: 0,
    recoveredRevenue: 0,
    pendingRevenue: 0,
    recoveryRate: 0
  },
  settings: {
    brandName: "Retryly",
    supportEmail: "support@example.com",
    accentColor: "#0f766e",
    sendEmail: true,
    sendSms: false,
    retryMinutes: [15, 360, 1440]
  },
  campaigns: [],
  sessions: [],
  insights: {
    activeCampaign: "-",
    channelMix: { email: 0, sms: 0 },
    highestPriorityCampaign: null,
    countriesCovered: []
  }
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function stateLabel(state: SessionState): string {
  switch (state) {
    case "LIKELY_FAILED_PAYMENT":
      return "Recovering";
    case "RECOVERED":
      return "Recovered";
    case "EXPIRED":
      return "Expired";
    case "UNSUBSCRIBED":
      return "Suppressed";
    default:
      return "Pending";
  }
}

function stateTone(state: SessionState): "success" | "info" | "warning" | "critical" {
  switch (state) {
    case "RECOVERED":
      return "success";
    case "EXPIRED":
    case "UNSUBSCRIBED":
      return "critical";
    case "LIKELY_FAILED_PAYMENT":
      return "warning";
    default:
      return "info";
  }
}

function deliveryLabel(status?: string): string {
  if (!status) return "Not sent";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isFailureMessage(message: string): boolean {
  return /fail|could not|missing|error/i.test(message);
}

function Tip({ content }: { content: string }) {
  return (
    <Tooltip content={content} preferredPosition="above">
      <span className="tooltipActivator" aria-hidden="true">i</span>
    </Tooltip>
  );
}

export function App() {
  const appConfig = window.__APP_CONFIG__;
  const [data, setData] = useState<PlatformPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [saveScope, setSaveScope] = useState<AppSection | "">("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [section, setSection] = useState<AppSection>("overview");
  const [activatingPixel, setActivatingPixel] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const response = await fetch("/platform");
    const payload = (await response.json()) as PlatformPayload;
    setData(payload);
    setSelectedCampaignId((current) => current || payload.campaigns[0]?.id || "");
    setSelectedSessionId((current) => current || payload.sessions[0]?.id || "");
    setLoading(false);
  }

  const selectedCampaign = useMemo(
    () => data.campaigns.find((campaign) => campaign.id === selectedCampaignId) || data.campaigns[0],
    [data.campaigns, selectedCampaignId]
  );

  const selectedSession = useMemo(
    () => data.sessions.find((session) => session.id === selectedSessionId) || data.sessions[0],
    [data.sessions, selectedSessionId]
  );

  async function saveCampaign() {
    if (!selectedCampaign) return;
    setSaving(true);
    setSaveState("");
    setSaveScope("");
    const response = await fetch("/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selectedCampaign)
    });
    setSaving(false);
    if (!response.ok) {
      setSaveState("Campaign save failed.");
      setSaveScope("campaigns");
      return;
    }
    await refresh();
    setSaveState("Campaign saved.");
    setSaveScope("campaigns");
  }

  async function activateCampaign(id: string) {
    setSaving(true);
    setSaveState("");
    setSaveScope("");
    const response = await fetch(`/campaigns/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" })
    });
    setSaving(false);
    if (!response.ok) {
      setSaveState("Could not activate campaign.");
      setSaveScope("campaigns");
      return;
    }
    await refresh();
    setSaveState("Active campaign updated.");
    setSaveScope("campaigns");
  }

  async function saveSettings() {
    setSaving(true);
    setSaveState("");
    setSaveScope("");
    const response = await fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data.settings)
    });
    setSaving(false);
    if (!response.ok) {
      setSaveState("Settings save failed.");
      setSaveScope("settings");
      return;
    }
    await refresh();
    setSaveState("Settings saved.");
    setSaveScope("settings");
  }

  async function runFeedAction(
    checkoutToken: string,
    shopDomain: string,
    action: "mark_contacted" | "escalate_support"
  ) {
    const response = await fetch(`/sessions/${checkoutToken}/manual-outreach`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, shopDomain })
    });
    if (response.ok) await refresh();
  }

  async function generateOffer(checkoutToken: string, shopDomain: string) {
    const response = await fetch(`/sessions/${checkoutToken}/generate-offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopDomain })
    });
    if (response.ok) await refresh();
  }

  async function activatePixel() {
    const shopDomain = appConfig?.shop || data.sessions[0]?.shopDomain || "";
    if (!shopDomain) {
      setSaveState("Missing shop domain for pixel activation.");
      setSaveScope("settings");
      return;
    }
    setActivatingPixel(true);
    setSaveState("");
    setSaveScope("");
    const response = await fetch("/pixels/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopDomain })
    });
    const payload = (await response.json()) as { activated?: boolean; reason?: string };
    setActivatingPixel(false);
    setSaveState(response.ok ? "Web pixel activated for this store." : payload.reason || "Web pixel activation failed.");
    setSaveScope("settings");
  }

  async function applyAiDraft(mode: "urgent" | "concierge" | "concise") {
    if (!selectedCampaign) return;
    setSaving(true);
    setSaveState("");
    setSaveScope("");
    const response = await fetch("/campaigns/ai-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, campaign: selectedCampaign })
    });
    setSaving(false);
    if (!response.ok) {
      setSaveState("AI draft failed.");
      setSaveScope("campaigns");
      return;
    }
    const payload = (await response.json()) as { theme: NonNullable<typeof selectedCampaign>["theme"] };
    updateSelectedCampaign((campaign) => ({ ...campaign, theme: payload.theme }));
    setSaveState("AI draft applied. Review before saving.");
    setSaveScope("campaigns");
  }

  function updateSelectedCampaign(
    updater: (campaign: NonNullable<typeof selectedCampaign>) => NonNullable<typeof selectedCampaign>
  ) {
    if (!selectedCampaign) return;
    setData((current) => ({
      ...current,
      campaigns: current.campaigns.map((campaign) =>
        campaign.id === selectedCampaign.id ? updater(campaign as NonNullable<typeof selectedCampaign>) : campaign
      )
    }));
  }

  function updateSettings<K extends keyof PlatformPayload["settings"]>(
    key: K,
    value: PlatformPayload["settings"][K]
  ) {
    setData((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  const sectionOrder: AppSection[] = ["overview", "campaigns", "feed", "settings"];
  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "campaigns", content: "Campaign Studio" },
    { id: "feed", content: "Recovery Feed" },
    { id: "settings", content: "Settings" }
  ];
  const selectedTabIndex = sectionOrder.indexOf(section);

  const campaignTabs = data.campaigns.map((campaign) => ({
    id: campaign.id,
    content: campaign.name
  }));
  const selectedCampaignTabIndex = selectedCampaign ? data.campaigns.findIndex((campaign) => campaign.id === selectedCampaign.id) : 0;

  const summaryCards = [
    {
      label: "Recovered revenue",
      value: formatCurrency(data.commandCenter.recoveredRevenue),
      tone: "success",
      help: "Revenue already recovered from failed-payment sessions."
    },
    {
      label: "At-risk revenue",
      value: formatCurrency(data.commandCenter.pendingRevenue),
      tone: "caution",
      help: "Revenue currently tied to failed-payment sessions that are still recoverable."
    },
    {
      label: "Detected failures",
      value: String(data.commandCenter.detected),
      tone: "neutral",
      help: "Total sessions detected as likely failed payments."
    },
    {
      label: "Recovery rate",
      value: `${data.commandCenter.recoveryRate}%`,
      tone: "brand",
      help: "Recovered sessions divided by detected failed-payment sessions."
    }
  ];

  const saveBanner = saveState && saveScope === section ? (
    <Banner
      tone={isFailureMessage(saveState) ? "critical" : "success"}
      onDismiss={() => {
        setSaveState("");
        setSaveScope("");
      }}
    >
      {saveState}
    </Banner>
  ) : null;

  const prioritySessions = data.sessions.slice(0, 4);

  return (
    <Page fullWidth>
      <Layout>
        <Layout.Section>
          <Banner tone="info" title="Payment retry control center">
            <InlineStack align="space-between" blockAlign="start" gap="400">
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Run merchant-controlled failed-payment recovery inside Shopify Admin.</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Campaigns, delivery tracking, buyer engagement, and operator actions in one operating surface.
                </Text>
              </BlockStack>
              <BlockStack gap="200">
                <Badge tone="info">{loading ? "Loading" : `${data.commandCenter.active} live recoveries`}</Badge>
                <Text as="p" variant="bodySm" tone="subdued">Store: {appConfig?.shop || "Not connected"}</Text>
                <Text as="p" variant="bodySm" tone="subdued">Active campaign: {data.insights.activeCampaign}</Text>
              </BlockStack>
            </InlineStack>
          </Banner>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <LegacyTabs
                tabs={tabs}
                selected={selectedTabIndex < 0 ? 0 : selectedTabIndex}
                onSelect={(index) => setSection(sectionOrder[index])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {section === "overview" ? (
          <>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  {saveBanner}
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="100">
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="h3" variant="headingMd">Command Center</Text>
                        <Tip content="Primary operating view for recovery performance, campaign posture, and sessions needing action." />
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        A Shopify-style operating view for revenue at risk, recoveries in flight, and buyer response.
                      </Text>
                    </BlockStack>
                    <Badge tone="success">{`${data.commandCenter.active} active now`}</Badge>
                  </InlineStack>
                  <div className="polarisMetricGrid">
                    {summaryCards.map((card) => (
                      <div key={card.label} className={`dashboardMetricTile dashboardMetricTile-${card.tone}`}>
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="p" variant="bodySm" tone="subdued">{card.label}</Text>
                            <Tip content={card.help} />
                          </InlineStack>
                          <Text as="p" variant="headingLg">{card.value}</Text>
                        </BlockStack>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section>
              <div className="polarisOverviewGrid">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Recovery health</Text>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">Recovered orders</Text>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{String(data.commandCenter.recovered)}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">Expired flows</Text>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{String(data.commandCenter.expired)}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">Suppression risk</Text>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{data.commandCenter.active > 0 ? "Monitor" : "Low"}</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">Markets covered: {data.insights.countriesCovered.join(", ") || "Global"}</Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Program status</Text>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">Primary campaign</Text>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{data.insights.highestPriorityCampaign || "-"}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">Email steps</Text>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{String(data.insights.channelMix.email)}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="p" variant="bodySm" tone="subdued">SMS steps</Text>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{String(data.insights.channelMix.sms)}</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">Active route: {selectedCampaign?.experience.destination || "checkout"}</Text>
                  </BlockStack>
                </Card>
              </div>
            </Layout.Section>
            <Layout.Section>
              <div className="polarisOverviewGrid">
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Active campaign summary</Text>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">{selectedCampaign?.name || "No campaign selected"}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Destination: {selectedCampaign?.experience.destination || "checkout"} | Segment: {selectedCampaign?.rules.customerSegment || "all"}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Discount: {selectedCampaign?.experience.discountAfterAttempt ? `after attempt ${selectedCampaign.experience.discountAfterAttempt}` : "disabled"}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Payment methods: {selectedCampaign?.rules.paymentMethods.join(", ") || "All methods"}
                    </Text>
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingMd">Operator focus</Text>
                    {prioritySessions.length === 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued">No live failed-payment sessions yet.</Text>
                    ) : (
                      prioritySessions.map((session) => (
                        <InlineStack key={session.id} align="space-between" blockAlign="center">
                          <BlockStack gap="0">
                            <Text as="p" variant="bodySm" fontWeight="semibold">{session.checkoutToken}</Text>
                            <Text as="p" variant="bodyXs" tone="subdued">{session.campaignName}</Text>
                          </BlockStack>
                          <Badge tone={stateTone(session.state)}>{stateLabel(session.state)}</Badge>
                        </InlineStack>
                      ))
                    )}
                  </BlockStack>
                </Card>
              </div>
            </Layout.Section>
          </>
        ) : null}

        {section === "campaigns" ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                {saveBanner}
                <Text as="h3" variant="headingMd">Campaign Studio</Text>
                {campaignTabs.length > 0 ? (
                  <LegacyTabs
                    tabs={campaignTabs}
                    selected={selectedCampaignTabIndex < 0 ? 0 : selectedCampaignTabIndex}
                    onSelect={(index) => setSelectedCampaignId(data.campaigns[index].id)}
                  />
                ) : null}
                {selectedCampaign ? (
                  <div className="polarisTwoColumnGrid">
                    <Card background="bg-surface-secondary" padding="400">
                      <BlockStack gap="400">
                        <Text as="h4" variant="headingSm">Audience</Text>
                        <TextField label="Campaign name" autoComplete="off" value={selectedCampaign.name} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, name: value }))} />
                        <TextField label="Minimum order value" autoComplete="off" type="number" value={String(selectedCampaign.rules.minimumOrderValue)} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, rules: { ...c.rules, minimumOrderValue: Number(value) || 0 } }))} />
                        <Select
                          label="Customer segment"
                          options={[
                            { label: "All customers", value: "all" },
                            { label: "New customers", value: "new" },
                            { label: "Returning customers", value: "returning" },
                            { label: "VIP customers", value: "vip" }
                          ]}
                          value={selectedCampaign.rules.customerSegment}
                          onChange={(value) => updateSelectedCampaign((c) => ({ ...c, rules: { ...c.rules, customerSegment: value as typeof c.rules.customerSegment } }))}
                        />
                          <TextField label={<InlineStack gap="100" blockAlign="center"><span>Countries</span><Tip content="Comma-separated ISO country codes. When Shopify sends country details, the runtime normalizes and stores them here for filtering and reporting." /></InlineStack>} helpText="Comma-separated country codes" autoComplete="off" value={selectedCampaign.rules.includeCountries.join(",")} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, rules: { ...c.rules, includeCountries: value.split(",").map((entry) => entry.trim().toUpperCase()).filter(Boolean) } }))} />
                        <TextField
                          label={
                            <InlineStack gap="100" blockAlign="center">
                              <span>Payment methods</span>
                              <Tip content="Limit this campaign to specific gateways like credit_card, shop_pay, or paypal. Leave blank to target all payment methods." />
                            </InlineStack>
                          }
                          autoComplete="off"
                          helpText="Comma-separated gateway keys"
                          value={selectedCampaign.rules.paymentMethods.join(",")}
                          onChange={(value) => updateSelectedCampaign((c) => ({ ...c, rules: { ...c.rules, paymentMethods: value.split(",").map((entry) => entry.trim()).filter(Boolean) } }))}
                        />
                      </BlockStack>
                    </Card>

                    <Card background="bg-surface-secondary" padding="400">
                      <BlockStack gap="400">
                        <Text as="h4" variant="headingSm">Retry experience</Text>
                        <Select
                          label={<InlineStack gap="100" blockAlign="center"><span>Retry destination</span><Tip content="Choose whether the retry link resumes checkout, falls back to cart, or routes to direct support." /></InlineStack>}
                          options={[
                            { label: "Checkout", value: "checkout" },
                            { label: "Cart", value: "cart" },
                            { label: "Direct support", value: "support" }
                          ]}
                          value={selectedCampaign.experience.destination}
                          onChange={(value) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, destination: value as typeof c.experience.destination } }))}
                        />
                        <div className="polarisTwoColumnGrid">
                          <TextField label={<InlineStack gap="100" blockAlign="center"><span>Discount after attempt</span><Tip content="Offer a discount only after the chosen number of failed attempts." /></InlineStack>} autoComplete="off" type="number" value={String(selectedCampaign.experience.discountAfterAttempt ?? 0)} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, discountAfterAttempt: Number(value) || null } }))} />
                          <TextField label={<InlineStack gap="100" blockAlign="center"><span>Discount value</span><Tip content="This value is used for both the in-app rescue code and Shopify discount creation." /></InlineStack>} autoComplete="off" type="number" value={String(selectedCampaign.experience.discountValue)} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, discountValue: Number(value) || 0 } }))} />
                        </div>
                        <Select
                          label={<InlineStack gap="100" blockAlign="center"><span>Discount type</span><Tip content="Percentage creates a proportional discount. Fixed creates a flat amount off." /></InlineStack>}
                          options={[
                            { label: "Percentage", value: "percentage" },
                            { label: "Fixed", value: "fixed" }
                          ]}
                          value={selectedCampaign.experience.discountType}
                          onChange={(value) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, discountType: value as typeof c.experience.discountType } }))}
                        />
                        <TextField label={<InlineStack gap="100" blockAlign="center"><span>Direct contact after attempt</span><Tip content="After this attempt number, recovery copy shifts to merchant-assisted support." /></InlineStack>} autoComplete="off" type="number" value={String(selectedCampaign.experience.directContactAfterAttempt ?? 0)} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, directContactAfterAttempt: Number(value) || null } }))} />
                        <Checkbox
                          label={
                            <InlineStack gap="100" blockAlign="center">
                              <span>Allow agent escalation</span>
                              <Tip content="Let the campaign shift from automated recovery to direct merchant-assisted support after the configured attempt." />
                            </InlineStack>
                          }
                          checked={selectedCampaign.experience.allowAgentEscalation}
                          onChange={(checked) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, allowAgentEscalation: checked } }))}
                        />
                      </BlockStack>
                    </Card>
                  </div>
                ) : null}

                {selectedCampaign ? (
                  <Card background="bg-surface-secondary" padding="400">
                    <BlockStack gap="400">
                      <Text as="h4" variant="headingSm">Sequence Builder</Text>
                      {selectedCampaign.steps.map((step, index) => (
                        <Card key={step.id} padding="400">
                          <BlockStack gap="300">
                            <Text as="h5" variant="headingXs">Step {index + 1}</Text>
                            <div className="polarisThreeColumnGrid">
                              <TextField label="Delay (min)" autoComplete="off" type="number" value={String(step.delayMinutes)} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, steps: c.steps.map((item) => item.id === step.id ? { ...item, delayMinutes: Number(value) || 1 } : item) }))} />
                              <Select label="Channel" options={[{ label: "Email", value: "email" }, { label: "SMS", value: "sms" }]} value={step.channel} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, steps: c.steps.map((item) => item.id === step.id ? { ...item, channel: value as CampaignChannel } : item) }))} />
                              <Select label="Tone" options={[{ label: "Steady", value: "steady" }, { label: "Urgent", value: "urgent" }, { label: "Concierge", value: "concierge" }, { label: "Rescue", value: "rescue" }]} value={step.tone} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, steps: c.steps.map((item) => item.id === step.id ? { ...item, tone: value as CampaignTone } : item) }))} />
                            </div>
                          </BlockStack>
                        </Card>
                      ))}
                    </BlockStack>
                  </Card>
                ) : null}

                {selectedCampaign ? (
                  <Card background="bg-surface-secondary" padding="400">
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="100" blockAlign="center">
                          <Text as="h4" variant="headingSm">Creative</Text>
                          <Tip content="Use AI assist to generate a first draft, then refine and save the final copy manually." />
                        </InlineStack>
                        <InlineStack gap="200">
                          <Button size="slim" onClick={() => void applyAiDraft("urgent")} disabled={saving}>AI: Urgency</Button>
                          <Button size="slim" onClick={() => void applyAiDraft("concierge")} disabled={saving}>AI: Concierge</Button>
                          <Button size="slim" onClick={() => void applyAiDraft("concise")} disabled={saving}>AI: Concise</Button>
                        </InlineStack>
                      </InlineStack>
                      <TextField label="Email headline" autoComplete="off" value={selectedCampaign.theme.headline} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, theme: { ...c.theme, headline: value } }))} />
                      <TextField label="Email body" autoComplete="off" multiline={4} value={selectedCampaign.theme.body} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, theme: { ...c.theme, body: value } }))} />
                      <TextField label="SMS copy" autoComplete="off" multiline={3} value={selectedCampaign.theme.sms} onChange={(value) => updateSelectedCampaign((c) => ({ ...c, theme: { ...c.theme, sms: value } }))} />
                    </BlockStack>
                  </Card>
                ) : null}

                <InlineStack align="space-between" blockAlign="center" gap="300">
                  <InlineStack gap="300">
                    <Button variant="primary" onClick={() => void saveCampaign()} loading={saving} disabled={!selectedCampaign}>Save campaign</Button>
                    {selectedCampaign ? <Button onClick={() => void activateCampaign(selectedCampaign.id)} disabled={saving}>Make active</Button> : null}
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">Use Shopify-style controls here first, then expand BFS polish.</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        {section === "feed" ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                {saveBanner}
                <Text as="h3" variant="headingMd">Recovery Feed</Text>
                {data.sessions.length === 0 ? (
                  <Text as="p" variant="bodyMd" tone="subdued">No failed sessions yet.</Text>
                ) : (
                  <IndexTable
                    selectable={false}
                    itemCount={data.sessions.length}
                    resourceName={{ singular: "failed payment session", plural: "failed payment sessions" }}
                    headings={[
                      { title: "Order" },
                      { title: "Campaign" },
                      { title: "Payment" },
                      { title: "Delivery" },
                      { title: "Engagement" },
                      { title: "State" },
                      { title: "Actions" }
                    ]}
                  >
                    {data.sessions.map((session, index) => (
                      <IndexTable.Row id={session.id} key={session.id} position={index} onClick={() => setSelectedSessionId(session.id)}>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm" fontWeight="semibold">{session.checkoutToken}</Text>
                            <Text as="span" variant="bodyXs" tone="subdued">{session.email || session.phone || "No reachable contact"}</Text>
                            <Text as="span" variant="bodyXs" tone="subdued">{formatCurrency(session.amountSubtotal || 0)} {session.countryCode || "--"} / {session.customerSegment || "all"}</Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm">{session.campaignName}</Text>
                            <Text as="span" variant="bodyXs" tone="subdued">{session.offer ? `Offer ${session.offer.code}` : "No offer yet"}</Text>
                            <Text as="span" variant="bodyXs" tone={session.discountSync?.status === "failed" ? "critical" : "subdued"}>
                              {session.discountSync?.status === "synced"
                                ? "Shopify discount synced"
                                : session.discountSync?.status === "failed"
                                  ? `Discount sync failed${session.discountSync.reason ? `: ${session.discountSync.reason}` : ""}`
                                  : "Discount not synced yet"}
                            </Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodySm">{session.paymentMethod || "Unknown"}</Text>
                            <Text as="span" variant="bodyXs" tone="subdued">Attempt {session.attemptCount + 1}</Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodyXs">Email: {deliveryLabel(session.deliveryStatus?.emailStatus)}</Text>
                            <Text as="span" variant="bodyXs">SMS: {deliveryLabel(session.deliveryStatus?.smsStatus)}</Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Text as="span" variant="bodyXs">Opened {session.engagement?.opens || 0}</Text>
                            <Text as="span" variant="bodyXs">Clicked {session.engagement?.clicks || 0}</Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="100">
                            <Badge tone={stateTone(session.state)}>{stateLabel(session.state)}</Badge>
                            <Text as="span" variant="bodyXs" tone="subdued">{session.operatorAction?.lastAction ? `Last: ${session.operatorAction.lastAction.replace("_", " ")}` : "No manual action"}</Text>
                          </BlockStack>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <BlockStack gap="200">
                            <Button size="slim" textAlign="left" onClick={() => void runFeedAction(session.checkoutToken, session.shopDomain, "mark_contacted")}>Mark contacted</Button>
                            <Button size="slim" textAlign="left" onClick={() => void runFeedAction(session.checkoutToken, session.shopDomain, "escalate_support")}>Escalate</Button>
                            <Button size="slim" textAlign="left" onClick={() => void generateOffer(session.checkoutToken, session.shopDomain)}>Generate offer</Button>
                          </BlockStack>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    ))}
                  </IndexTable>
                )}

                {selectedSession ? (
                  <>
                    <Divider />
                    <Card background="bg-surface-secondary" padding="400">
                      <BlockStack gap="400">
                        <InlineStack align="space-between" blockAlign="center">
                          <BlockStack gap="100">
                            <Text as="h4" variant="headingSm">Session Detail</Text>
                            <Text as="p" variant="bodySm" tone="subdued">{selectedSession.checkoutToken}</Text>
                          </BlockStack>
                          <Badge tone={stateTone(selectedSession.state)}>{stateLabel(selectedSession.state)}</Badge>
                        </InlineStack>
                        <div className="polarisOverviewGrid">
                          <Card padding="400">
                            <BlockStack gap="200">
                              <Text as="p" variant="bodySm" tone="subdued">Recovery path</Text>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{selectedSession.campaignName}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">{selectedSession.paymentMethod || "Unknown payment method"} routed through {selectedCampaign?.experience.destination || "checkout"}.</Text>
                              <Text as="p" variant="bodySm" tone="subdued">Retry strategy: {selectedSession.retryStrategy || "Pending route resolution"}</Text>
                            </BlockStack>
                          </Card>
                          <Card padding="400">
                            <BlockStack gap="200">
                              <Text as="p" variant="bodySm" tone="subdued">Delivery status</Text>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">Email: {deliveryLabel(selectedSession.deliveryStatus?.emailStatus)}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">SMS: {deliveryLabel(selectedSession.deliveryStatus?.smsStatus)}</Text>
                            </BlockStack>
                          </Card>
                          <Card padding="400">
                            <BlockStack gap="200">
                              <Text as="p" variant="bodySm" tone="subdued">Buyer engagement</Text>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{selectedSession.engagement?.opens || 0} opens / {selectedSession.engagement?.clicks || 0} clicks</Text>
                              <Text as="p" variant="bodySm" tone="subdued">{selectedSession.operatorAction?.lastAction ? `Last manual action: ${selectedSession.operatorAction.lastAction.replace("_", " ")}` : "No operator escalation yet."}</Text>
                            </BlockStack>
                          </Card>
                          <Card padding="400">
                            <BlockStack gap="200">
                              <Text as="p" variant="bodySm" tone="subdued">Offer</Text>
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{selectedSession.offer?.code || "No offer generated"}</Text>
                              <Text as="p" variant="bodySm" tone={selectedSession.discountSync?.status === "failed" ? "critical" : "subdued"}>
                                {selectedSession.discountSync?.status === "synced"
                                  ? "Shopify discount synced and ready."
                                  : selectedSession.discountSync?.status === "failed"
                                    ? `Shopify discount failed: ${selectedSession.discountSync.reason || "Unknown reason"}`
                                    : selectedSession.offer
                                      ? "Rescue code is ready for the next touch."
                                      : "Generate an offer if this session needs incentive recovery."}
                              </Text>
                              <Text as="p" variant="bodySm" tone="subdued">Suggested fallback methods: {selectedSession.recommendedPaymentOptions?.join(", ") || "Credit card, Shop Pay, PayPal"}</Text>
                            </BlockStack>
                          </Card>
                        </div>
                      </BlockStack>
                    </Card>
                  </>
                ) : null}
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        {section === "settings" ? (
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                {saveBanner}
                <Text as="h3" variant="headingMd">Merchant Settings</Text>
                <div className="polarisTwoColumnGrid">
                  <Card background="bg-surface-secondary" padding="400">
                    <BlockStack gap="400">
                      <Text as="h4" variant="headingSm">Branding</Text>
                      <TextField label="Brand name" autoComplete="off" value={data.settings.brandName} onChange={(value) => updateSettings("brandName", value)} />
                      <TextField label="Support email" autoComplete="email" type="email" value={data.settings.supportEmail} onChange={(value) => updateSettings("supportEmail", value)} />
                      <TextField label="Accent color" autoComplete="off" value={data.settings.accentColor} onChange={(value) => updateSettings("accentColor", value)} />
                    </BlockStack>
                  </Card>

                  <Card background="bg-surface-secondary" padding="400">
                    <BlockStack gap="400">
                      <Text as="h4" variant="headingSm">Recovery defaults</Text>
                      <TextField
                        label={
                          <InlineStack gap="100" blockAlign="center">
                            <span>Default retry cadence (minutes)</span>
                            <Tip content="Comma-separated intervals. Example: 15, 360, 1440 for 15 minutes, 6 hours, and 24 hours." />
                          </InlineStack>
                        }
                        autoComplete="off"
                        value={data.settings.retryMinutes.join(",")}
                        onChange={(value) => updateSettings("retryMinutes", value.split(",").map((entry) => Number(entry.trim())).filter((entry) => Number.isFinite(entry) && entry > 0))}
                      />
                      <Checkbox label="Email recovery enabled" checked={data.settings.sendEmail} onChange={(checked) => updateSettings("sendEmail", checked)} />
                      <Checkbox label="SMS recovery enabled" checked={data.settings.sendSms} onChange={(checked) => updateSettings("sendSms", checked)} />
                      <Text as="p" variant="bodySm" tone="subdued">Route strategy: {selectedCampaign?.experience.destination || "checkout"}</Text>
                    </BlockStack>
                  </Card>
                </div>

                <Card background="bg-surface-secondary" padding="400">
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <Text as="h4" variant="headingSm">Shopify signals</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Activate live checkout event capture and pixel-based recovery signals.</Text>
                      </BlockStack>
                      <Tip content="Use this after reinstall so the store grants pixel scopes. The app will try to create the web pixel registration for this shop." />
                    </InlineStack>
                    <InlineStack align="space-between" blockAlign="center">
                      <Button onClick={() => void activatePixel()} loading={activatingPixel}>Activate store pixel</Button>
                      <Text as="p" variant="bodySm" tone="subdued">Reinstall the app after scope changes.</Text>
                    </InlineStack>
                  </BlockStack>
                </Card>

                <InlineStack align="space-between" blockAlign="center">
                  <Button variant="primary" onClick={() => void saveSettings()} loading={saving}>Save settings</Button>
                  <Text as="p" variant="bodySm" tone="subdued">Polaris-first layout for BFS alignment.</Text>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        ) : null}

        <Layout.Section>
          <Box paddingBlockEnd="600" />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
