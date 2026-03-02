import { useEffect, useMemo, useState } from "react";
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

function deliveryLabel(status?: string): string {
  if (!status) return "Not sent";
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function App() {
  const appConfig = window.__APP_CONFIG__;
  const [data, setData] = useState<PlatformPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("");
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
    const response = await fetch("/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selectedCampaign)
    });
    setSaving(false);
    if (!response.ok) {
      setSaveState("Campaign save failed.");
      return;
    }
    await refresh();
    setSaveState("Campaign saved.");
  }

  async function activateCampaign(id: string) {
    setSaving(true);
    setSaveState("");
    const response = await fetch(`/campaigns/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ACTIVE" })
    });
    setSaving(false);
    if (!response.ok) {
      setSaveState("Could not activate campaign.");
      return;
    }
    await refresh();
    setSaveState("Active campaign updated.");
  }

  async function saveSettings() {
    setSaving(true);
    setSaveState("");
    const response = await fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data.settings)
    });
    setSaving(false);
    if (!response.ok) {
      setSaveState("Settings save failed.");
      return;
    }
    await refresh();
    setSaveState("Settings saved.");
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
    if (response.ok) {
      await refresh();
    }
  }

  async function generateOffer(checkoutToken: string, shopDomain: string) {
    const response = await fetch(`/sessions/${checkoutToken}/generate-offer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopDomain })
    });
    if (response.ok) {
      await refresh();
    }
  }

  async function activatePixel() {
    const shopDomain = appConfig?.shop || data.sessions[0]?.shopDomain || "";
    if (!shopDomain) {
      setSaveState("Missing shop domain for pixel activation.");
      return;
    }
    setActivatingPixel(true);
    setSaveState("");
    const response = await fetch("/pixels/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopDomain })
    });
    const payload = (await response.json()) as { activated?: boolean; reason?: string };
    setActivatingPixel(false);
    setSaveState(response.ok ? "Web pixel activated for this store." : payload.reason || "Web pixel activation failed.");
  }

  function updateSelectedCampaign(updater: (campaign: NonNullable<typeof selectedCampaign>) => NonNullable<typeof selectedCampaign>) {
    if (!selectedCampaign) return;
    setData((current) => ({
      ...current,
      campaigns: current.campaigns.map((campaign) =>
        campaign.id === selectedCampaign.id ? updater(campaign as NonNullable<typeof selectedCampaign>) : campaign
      )
    }));
  }

  function updateSettings<K extends keyof PlatformPayload["settings"]>(key: K, value: PlatformPayload["settings"][K]) {
    setData((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  }

  const commandCards = [
    { label: "Recovered revenue", value: formatCurrency(data.commandCenter.recoveredRevenue), tone: "success" },
    { label: "At-risk revenue", value: formatCurrency(data.commandCenter.pendingRevenue), tone: "warning" },
    { label: "Detected failures", value: String(data.commandCenter.detected), tone: "default" },
    { label: "Recovery rate", value: `${data.commandCenter.recoveryRate}%`, tone: "default" }
  ];

  return (
    <main className="layout">
      <header className="hero" style={{ borderTopColor: data.settings.accentColor }}>
        <div>
          <p className="kicker">Merchant-Controlled Recovery Platform</p>
          <h1>Control failed-payment recovery like a revenue program.</h1>
          <p className="hero-copy">
            Separate campaign design, operational recovery, and merchant settings so sellers can tune payment recovery without touching code.
          </p>
        </div>
        <div className="hero-side">
          <span className="pill">{loading ? "Loading" : `${data.commandCenter.active} live recoveries`}</span>
          <p>{appConfig?.embedded ? "Embedded in Shopify Admin" : "Standalone app view"}</p>
          <p>Store: {appConfig?.shop || "Not connected"}</p>
          <p>Active campaign: {data.insights.activeCampaign}</p>
        </div>
      </header>

      <section className="card surface nav-surface">
        <div className="campaign-tabs nav-tabs">
          {[
            ["overview", "Overview"],
            ["campaigns", "Campaign Studio"],
            ["feed", "Recovery Feed"],
            ["settings", "Settings"]
          ].map(([value, label]) => (
            <button
              key={value}
              className={`tab ${section === value ? "active" : ""}`}
              onClick={() => setSection(value as AppSection)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {section === "overview" ? (
        <>
          <section className="surface-grid top-grid">
            <section className="card surface">
              <div className="section-head">
                <h3>Command Center</h3>
                <span>Live revenue operations</span>
              </div>
              <div className="metrics compact">
                {commandCards.map((card) => (
                  <article key={card.label} className={`metric metric-${card.tone}`}>
                    <p>{card.label}</p>
                    <h2>{card.value}</h2>
                  </article>
                ))}
              </div>
              <div className="command-strip">
                <div><span className="eyebrow">Recovered orders</span><strong>{data.commandCenter.recovered}</strong></div>
                <div><span className="eyebrow">Expired flows</span><strong>{data.commandCenter.expired}</strong></div>
                <div><span className="eyebrow">Markets covered</span><strong>{data.insights.countriesCovered.join(", ") || "Global"}</strong></div>
              </div>
            </section>
            <section className="card surface">
              <div className="section-head">
                <h3>Insights</h3>
                <span>Current platform shape</span>
              </div>
              <div className="insight-list">
                <div><span>Primary campaign</span><strong>{data.insights.highestPriorityCampaign || "-"}</strong></div>
                <div><span>Email steps</span><strong>{data.insights.channelMix.email}</strong></div>
                <div><span>SMS steps</span><strong>{data.insights.channelMix.sms}</strong></div>
                <div><span>Support route</span><strong>{selectedCampaign?.experience.destination || "checkout"}</strong></div>
              </div>
            </section>
          </section>
        </>
      ) : null}

      {section === "campaigns" ? (
        <section className="card surface campaign-studio">
          <div className="section-head">
            <h3>Campaign Studio</h3>
            <span>Targeting, landing behavior, incentives, and escalation</span>
          </div>
          <div className="campaign-tabs">
            {data.campaigns.map((campaign) => (
              <button
                key={campaign.id}
                className={`tab ${campaign.id === selectedCampaign?.id ? "active" : ""}`}
                onClick={() => setSelectedCampaignId(campaign.id)}
              >
                {campaign.name}
                <small>{campaign.status}</small>
              </button>
            ))}
          </div>
          {selectedCampaign ? (
            <div className="studio-grid">
              <div className="studio-column">
                <label>Campaign name
                  <input value={selectedCampaign.name} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, name: e.target.value }))} />
                </label>
                <label>Minimum order value
                  <input type="number" min={0} value={selectedCampaign.rules.minimumOrderValue} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, rules: { ...c.rules, minimumOrderValue: Number(e.target.value) || 0 } }))} />
                </label>
                <label>Customer segment
                  <select value={selectedCampaign.rules.customerSegment} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, rules: { ...c.rules, customerSegment: e.target.value as typeof c.rules.customerSegment } }))}>
                    <option value="all">All customers</option>
                    <option value="new">New customers</option>
                    <option value="returning">Returning customers</option>
                    <option value="vip">VIP customers</option>
                  </select>
                </label>
                <label>Countries
                  <input value={selectedCampaign.rules.includeCountries.join(",")} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, rules: { ...c.rules, includeCountries: e.target.value.split(",").map((v) => v.trim().toUpperCase()).filter(Boolean) } }))} />
                </label>
                <label>Payment methods
                  <input value={selectedCampaign.rules.paymentMethods.join(",")} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, rules: { ...c.rules, paymentMethods: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } }))} />
                </label>
              </div>
              <div className="studio-column">
                <div className="section-subhead">Retry Experience</div>
                <label>Retry destination
                  <select value={selectedCampaign.experience.destination} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, destination: e.target.value as typeof c.experience.destination } }))}>
                    <option value="checkout">Checkout</option>
                    <option value="cart">Cart</option>
                    <option value="support">Direct support</option>
                  </select>
                </label>
                <div className="inline-pair">
                  <label>Discount after attempt
                    <input type="number" min={0} value={selectedCampaign.experience.discountAfterAttempt ?? 0} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, discountAfterAttempt: Number(e.target.value) || null } }))} />
                  </label>
                  <label>Discount value
                    <input type="number" min={0} value={selectedCampaign.experience.discountValue} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, discountValue: Number(e.target.value) || 0 } }))} />
                  </label>
                </div>
                <label>Discount type
                  <select value={selectedCampaign.experience.discountType} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, discountType: e.target.value as typeof c.experience.discountType } }))}>
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </label>
                <label>Direct contact after attempt
                  <input type="number" min={0} value={selectedCampaign.experience.directContactAfterAttempt ?? 0} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, directContactAfterAttempt: Number(e.target.value) || null } }))} />
                </label>
                <label className="toggle"><input type="checkbox" checked={selectedCampaign.experience.allowAgentEscalation} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, experience: { ...c.experience, allowAgentEscalation: e.target.checked } }))} /><span>Allow agent escalation</span></label>
                <div className="control-list compact-list">
                  <div><span>Buyer landing</span><strong>{selectedCampaign.experience.destination}</strong></div>
                  <div><span>Discount policy</span><strong>{selectedCampaign.experience.discountAfterAttempt ? `After attempt ${selectedCampaign.experience.discountAfterAttempt}` : "Off"}</strong></div>
                  <div><span>Manual support</span><strong>{selectedCampaign.experience.directContactAfterAttempt ? `After attempt ${selectedCampaign.experience.directContactAfterAttempt}` : "Off"}</strong></div>
                </div>
              </div>
              <div className="studio-column full-width">
                <div className="section-subhead">Sequence Builder</div>
                <div className="step-list">
                  {selectedCampaign.steps.map((step, index) => (
                    <div key={step.id} className="step-card">
                      <div className="step-index">Step {index + 1}</div>
                      <div className="step-grid three-up">
                        <label>Delay (min)
                          <input type="number" min={1} value={step.delayMinutes} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, steps: c.steps.map((x) => x.id === step.id ? { ...x, delayMinutes: Number(e.target.value) || 1 } : x) }))} />
                        </label>
                        <label>Channel
                          <select value={step.channel} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, steps: c.steps.map((x) => x.id === step.id ? { ...x, channel: e.target.value as CampaignChannel } : x) }))}>
                            <option value="email">Email</option>
                            <option value="sms">SMS</option>
                          </select>
                        </label>
                        <label>Tone
                          <select value={step.tone} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, steps: c.steps.map((x) => x.id === step.id ? { ...x, tone: e.target.value as CampaignTone } : x) }))}>
                            <option value="steady">Steady</option>
                            <option value="urgent">Urgent</option>
                            <option value="concierge">Concierge</option>
                            <option value="rescue">Rescue</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="studio-column full-width">
                <div className="section-subhead">Creative</div>
                <label>Email headline
                  <input value={selectedCampaign.theme.headline} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, theme: { ...c.theme, headline: e.target.value } }))} />
                </label>
                <label>Email body
                  <textarea value={selectedCampaign.theme.body} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, theme: { ...c.theme, body: e.target.value } }))} />
                </label>
                <label>SMS copy
                  <textarea value={selectedCampaign.theme.sms} onChange={(e) => updateSelectedCampaign((c) => ({ ...c, theme: { ...c.theme, sms: e.target.value } }))} />
                </label>
              </div>
            </div>
          ) : null}
          <div className="action-row">
            <button className="save-button" onClick={() => void saveCampaign()} disabled={saving || !selectedCampaign}>{saving ? "Saving..." : "Save campaign"}</button>
            {selectedCampaign ? <button className="ghost-button" onClick={() => void activateCampaign(selectedCampaign.id)} disabled={saving}>Make active</button> : null}
            {saveState ? <span className="status-line">{saveState}</span> : null}
          </div>
        </section>
      ) : null}

      {section === "feed" ? (
        <section className="card surface">
          <div className="section-head">
            <h3>Recovery Feed</h3>
            <span>Grid-first ops view with campaign, delivery, and engagement flags</span>
          </div>
          {data.sessions.length === 0 ? <div className="feed-empty">No failed sessions yet.</div> : (
            <div className="feed-grid-shell">
              <div className="feed-grid feed-grid-head">
                <span>Order</span>
                <span>Campaign</span>
                <span>Payment</span>
                <span>Delivery</span>
                <span>Engagement</span>
                <span>State</span>
                <span>Action</span>
              </div>
              <div className="feed-grid-body">
                {data.sessions.map((session) => (
                  <article
                    key={session.id}
                    className={`feed-grid feed-row ${selectedSession?.id === session.id ? "selected-row" : ""}`}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <div className="feed-cell order-cell">
                      <strong>{session.checkoutToken}</strong>
                      <p>{session.email || session.phone || "No reachable contact"}</p>
                      <p className="micro-copy">
                        {formatCurrency(session.amountSubtotal || 0)} {session.countryCode || "--"} / {session.customerSegment || "all"}
                      </p>
                    </div>
                    <div className="feed-cell">
                      <strong>{session.campaignName}</strong>
                      <p className="micro-copy">{session.offer ? `Offer ${session.offer.code}` : "No offer yet"}</p>
                    </div>
                    <div className="feed-cell">
                      <strong>{session.paymentMethod || "Unknown"}</strong>
                      <p className="micro-copy">Attempt {session.attemptCount + 1}</p>
                    </div>
                    <div className="feed-cell">
                      <span className="flag">{`Email: ${deliveryLabel(session.deliveryStatus?.emailStatus)}`}</span>
                      <span className="flag">{`SMS: ${deliveryLabel(session.deliveryStatus?.smsStatus)}`}</span>
                    </div>
                    <div className="feed-cell">
                      <span className={`flag ${session.engagement?.opens ? "flag-positive" : ""}`}>Opened {session.engagement?.opens || 0}</span>
                      <span className={`flag ${session.engagement?.clicks ? "flag-positive" : ""}`}>Clicked {session.engagement?.clicks || 0}</span>
                    </div>
                    <div className="feed-cell">
                      <span className={`badge badge-${session.state.toLowerCase()}`}>{stateLabel(session.state)}</span>
                      <p className="micro-copy">
                        {session.operatorAction?.lastAction ? `Last: ${session.operatorAction.lastAction.replace("_", " ")}` : "No manual action"}
                      </p>
                    </div>
                    <div className="feed-actions stacked">
                      <button className="ghost-button" onClick={(event) => { event.stopPropagation(); void runFeedAction(session.checkoutToken, session.shopDomain, "mark_contacted"); }}>Mark contacted</button>
                      <button className="ghost-button" onClick={(event) => { event.stopPropagation(); void runFeedAction(session.checkoutToken, session.shopDomain, "escalate_support"); }}>Escalate</button>
                      <button className="ghost-button" onClick={(event) => { event.stopPropagation(); void generateOffer(session.checkoutToken, session.shopDomain); }}>Generate offer</button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
          {selectedSession ? (
            <section className="session-drawer">
              <div className="section-head drawer-head">
                <div>
                  <h3>Session Detail</h3>
                  <span>{selectedSession.checkoutToken}</span>
                </div>
                <span className={`badge badge-${selectedSession.state.toLowerCase()}`}>{stateLabel(selectedSession.state)}</span>
              </div>
              <div className="drawer-grid">
                <div className="drawer-panel">
                  <span className="eyebrow">Recovery path</span>
                  <strong>{selectedSession.campaignName}</strong>
                  <p>{selectedSession.paymentMethod || "Unknown payment method"} routed through {selectedCampaign?.experience.destination || "checkout"}.</p>
                </div>
                <div className="drawer-panel">
                  <span className="eyebrow">Delivery status</span>
                  <strong>{`Email: ${deliveryLabel(selectedSession.deliveryStatus?.emailStatus)}`}</strong>
                  <p>{`SMS: ${deliveryLabel(selectedSession.deliveryStatus?.smsStatus)}`}</p>
                </div>
                <div className="drawer-panel">
                  <span className="eyebrow">Buyer engagement</span>
                  <strong>{`${selectedSession.engagement?.opens || 0} opens / ${selectedSession.engagement?.clicks || 0} clicks`}</strong>
                  <p>{selectedSession.operatorAction?.lastAction ? `Last manual action: ${selectedSession.operatorAction.lastAction.replace("_", " ")}` : "No operator escalation yet."}</p>
                </div>
                <div className="drawer-panel">
                  <span className="eyebrow">Offer</span>
                  <strong>{selectedSession.offer?.code || "No offer generated"}</strong>
                  <p>{selectedSession.offer ? "Rescue code is ready for the next touch." : "Generate an offer if this session needs incentive recovery."}</p>
                </div>
              </div>
            </section>
          ) : null}
          <div className="section-note">Retry links now resolve to checkout, cart, or support based on campaign policy and stored recovery payload.</div>
        </section>
      ) : null}

      {section === "settings" ? (
        <section className="card surface settings-page">
          <div className="section-head">
            <h3>Merchant Settings</h3>
            <span>Brand, compliance, and default controls</span>
          </div>
          <div className="studio-grid">
            <div className="studio-column">
              <label>Brand name
                <input value={data.settings.brandName} onChange={(e) => updateSettings("brandName", e.target.value)} />
              </label>
              <label>Support email
                <input value={data.settings.supportEmail} onChange={(e) => updateSettings("supportEmail", e.target.value)} />
              </label>
              <label>Accent color
                <div className="color-row"><input type="color" value={data.settings.accentColor} onChange={(e) => updateSettings("accentColor", e.target.value)} /><code>{data.settings.accentColor}</code></div>
              </label>
            </div>
            <div className="studio-column">
              <label>Default retry cadence (minutes)
                <input value={data.settings.retryMinutes.join(",")} onChange={(e) => updateSettings("retryMinutes", e.target.value.split(",").map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0))} />
              </label>
              <label className="toggle"><input type="checkbox" checked={data.settings.sendEmail} onChange={(e) => updateSettings("sendEmail", e.target.checked)} /><span>Email recovery enabled</span></label>
              <label className="toggle"><input type="checkbox" checked={data.settings.sendSms} onChange={(e) => updateSettings("sendSms", e.target.checked)} /><span>SMS recovery enabled</span></label>
              <div className="control-list">
                <div><span>Current route strategy</span><strong>{selectedCampaign?.experience.destination || "checkout"}</strong></div>
                <div><span>Support path</span><strong>{data.settings.supportEmail}</strong></div>
                <div><span>Embedded mode</span><strong>{appConfig?.embedded ? "Yes" : "No"}</strong></div>
              </div>
            </div>
          </div>
          <div className="action-row single-action">
            <button className="save-button" onClick={() => void saveSettings()} disabled={saving}>{saving ? "Saving..." : "Save settings"}</button>
            <button className="ghost-button" onClick={() => void activatePixel()} disabled={activatingPixel}>
              {activatingPixel ? "Activating pixel..." : "Activate store pixel"}
            </button>
            {saveState ? <span className="status-line">{saveState}</span> : null}
          </div>
          <div className="section-note">
            Install scopes now include discounts and web-pixel access. Reinstall the app after deploy so Shopify grants the expanded permissions.
          </div>
        </section>
      ) : null}
    </main>
  );
}
