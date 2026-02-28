import { useEffect, useMemo, useState } from "react";
import "./styles.css";

type SessionState = "LIKELY_FAILED_PAYMENT" | "RECOVERED" | "EXPIRED" | "UNSUBSCRIBED" | "PENDING";
type CampaignStatus = "ACTIVE" | "DRAFT" | "PAUSED";
type CampaignTone = "steady" | "urgent" | "concierge" | "rescue";
type CampaignChannel = "email" | "sms";

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
  }>;
  sessions: Array<{
    id: string;
    checkoutToken: string;
    email?: string;
    phone?: string;
    amountSubtotal?: number;
    countryCode?: string;
    customerSegment?: "all" | "new" | "returning" | "vip";
    state: SessionState;
    attemptCount: number;
    failedAt?: string;
    nextAttemptAt?: string;
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

export function App() {
  const appConfig = window.__APP_CONFIG__;
  const [data, setData] = useState<PlatformPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const response = await fetch("/platform");
    const payload = (await response.json()) as PlatformPayload;
    setData(payload);
    setSelectedCampaignId((current) => current || payload.campaigns[0]?.id || "");
    setLoading(false);
  }

  const selectedCampaign = useMemo(
    () => data.campaigns.find((campaign) => campaign.id === selectedCampaignId) || data.campaigns[0],
    [data.campaigns, selectedCampaignId]
  );

  const commandCards = [
    { label: "Recovered revenue", value: formatCurrency(data.commandCenter.recoveredRevenue), tone: "success" },
    { label: "At-risk revenue", value: formatCurrency(data.commandCenter.pendingRevenue), tone: "warning" },
    { label: "Detected failures", value: String(data.commandCenter.detected), tone: "default" },
    { label: "Recovery rate", value: `${data.commandCenter.recoveryRate}%`, tone: "default" }
  ];

  async function saveCampaign() {
    if (!selectedCampaign) return;
    setSaving(true);
    setSaveState("");
    const response = await fetch("/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selectedCampaign)
    });

    if (!response.ok) {
      setSaveState("Campaign save failed.");
      setSaving(false);
      return;
    }

    await refresh();
    setSaving(false);
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

    if (!response.ok) {
      setSaveState("Could not activate campaign.");
      setSaving(false);
      return;
    }

    await refresh();
    setSaving(false);
    setSaveState("Active campaign updated.");
  }

  function updateSelectedCampaign(updater: (campaign: NonNullable<typeof selectedCampaign>) => typeof selectedCampaign) {
    if (!selectedCampaign) return;
    setData((current) => ({
      ...current,
      campaigns: current.campaigns.map((campaign) =>
        campaign.id === selectedCampaign.id ? (updater(campaign) as typeof campaign) : campaign
      )
    }));
  }

  return (
    <main className="layout">
      <header className="hero" style={{ borderTopColor: data.settings.accentColor }}>
        <div>
          <p className="kicker">Merchant-Controlled Recovery Platform</p>
          <h1>Operate failed payment recovery like a revenue team, not a one-off automation.</h1>
          <p className="hero-copy">
            Design campaigns, define audience rules, control channel timing, and track recovered revenue inside one operational surface.
          </p>
        </div>
        <div className="hero-side">
          <span className="pill">{loading ? "Loading" : `${data.commandCenter.active} live recoveries`}</span>
          <p>{appConfig?.embedded ? "Embedded in Shopify Admin" : "Standalone app view"}</p>
          <p>Store: {appConfig?.shop || "Not connected"}</p>
          <p>Active campaign: {data.insights.activeCampaign}</p>
        </div>
      </header>

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
            <div>
              <span className="eyebrow">Open recoveries</span>
              <strong>{data.commandCenter.active}</strong>
            </div>
            <div>
              <span className="eyebrow">Recovered orders</span>
              <strong>{data.commandCenter.recovered}</strong>
            </div>
            <div>
              <span className="eyebrow">Expired flows</span>
              <strong>{data.commandCenter.expired}</strong>
            </div>
          </div>
        </section>

        <section className="card surface">
          <div className="section-head">
            <h3>Insights</h3>
            <span>Coverage and channel pressure</span>
          </div>
          <div className="insight-list">
            <div>
              <span>Primary campaign</span>
              <strong>{data.insights.highestPriorityCampaign || "-"}</strong>
            </div>
            <div>
              <span>Email steps</span>
              <strong>{data.insights.channelMix.email}</strong>
            </div>
            <div>
              <span>SMS steps</span>
              <strong>{data.insights.channelMix.sms}</strong>
            </div>
            <div>
              <span>Markets covered</span>
              <strong>{data.insights.countriesCovered.join(", ") || "Global"}</strong>
            </div>
          </div>
        </section>
      </section>

      <section className="surface-grid main-grid">
        <section className="card surface campaign-studio">
          <div className="section-head">
            <h3>Campaign Studio</h3>
            <span>Targeting, sequencing, and message design</span>
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
                <label>
                  Campaign name
                  <input
                    value={selectedCampaign.name}
                    onChange={(event) =>
                      updateSelectedCampaign((campaign) => ({ ...campaign, name: event.target.value }))
                    }
                  />
                </label>
                <label>
                  Minimum order value
                  <input
                    type="number"
                    min={0}
                    value={selectedCampaign.rules.minimumOrderValue}
                    onChange={(event) =>
                      updateSelectedCampaign((campaign) => ({
                        ...campaign,
                        rules: { ...campaign.rules, minimumOrderValue: Number(event.target.value) || 0 }
                      }))
                    }
                  />
                </label>
                <label>
                  Customer segment
                  <select
                    value={selectedCampaign.rules.customerSegment}
                    onChange={(event) =>
                      updateSelectedCampaign((campaign) => ({
                        ...campaign,
                        rules: {
                          ...campaign.rules,
                          customerSegment: event.target.value as typeof campaign.rules.customerSegment
                        }
                      }))
                    }
                  >
                    <option value="all">All customers</option>
                    <option value="new">New customers</option>
                    <option value="returning">Returning customers</option>
                    <option value="vip">VIP customers</option>
                  </select>
                </label>
                <label>
                  Countries (comma-separated)
                  <input
                    value={selectedCampaign.rules.includeCountries.join(",")}
                    onChange={(event) =>
                      updateSelectedCampaign((campaign) => ({
                        ...campaign,
                        rules: {
                          ...campaign.rules,
                          includeCountries: event.target.value
                            .split(",")
                            .map((value) => value.trim().toUpperCase())
                            .filter(Boolean)
                        }
                      }))
                    }
                  />
                </label>
                <div className="inline-pair">
                  <label>
                    Quiet hours start
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={selectedCampaign.rules.quietHoursStart}
                      onChange={(event) =>
                        updateSelectedCampaign((campaign) => ({
                          ...campaign,
                          rules: { ...campaign.rules, quietHoursStart: Number(event.target.value) || 0 }
                        }))
                      }
                    />
                  </label>
                  <label>
                    Quiet hours end
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={selectedCampaign.rules.quietHoursEnd}
                      onChange={(event) =>
                        updateSelectedCampaign((campaign) => ({
                          ...campaign,
                          rules: { ...campaign.rules, quietHoursEnd: Number(event.target.value) || 0 }
                        }))
                      }
                    />
                  </label>
                </div>
              </div>

              <div className="studio-column">
                <div className="section-subhead">Sequence Builder</div>
                <div className="step-list">
                  {selectedCampaign.steps.map((step, index) => (
                    <div key={step.id} className="step-card">
                      <div className="step-index">Step {index + 1}</div>
                      <div className="step-grid">
                        <label>
                          Delay (min)
                          <input
                            type="number"
                            min={1}
                            value={step.delayMinutes}
                            onChange={(event) =>
                              updateSelectedCampaign((campaign) => ({
                                ...campaign,
                                steps: campaign.steps.map((candidate) =>
                                  candidate.id === step.id
                                    ? { ...candidate, delayMinutes: Number(event.target.value) || 1 }
                                    : candidate
                                )
                              }))
                            }
                          />
                        </label>
                        <label>
                          Channel
                          <select
                            value={step.channel}
                            onChange={(event) =>
                              updateSelectedCampaign((campaign) => ({
                                ...campaign,
                                steps: campaign.steps.map((candidate) =>
                                  candidate.id === step.id
                                    ? { ...candidate, channel: event.target.value as CampaignChannel }
                                    : candidate
                                )
                              }))
                            }
                          >
                            <option value="email">Email</option>
                            <option value="sms">SMS</option>
                          </select>
                        </label>
                        <label>
                          Tone
                          <select
                            value={step.tone}
                            onChange={(event) =>
                              updateSelectedCampaign((campaign) => ({
                                ...campaign,
                                steps: campaign.steps.map((candidate) =>
                                  candidate.id === step.id
                                    ? { ...candidate, tone: event.target.value as CampaignTone }
                                    : candidate
                                )
                              }))
                            }
                          >
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
                <div className="section-subhead">Creative Control</div>
                <label>
                  Email headline
                  <input
                    value={selectedCampaign.theme.headline}
                    onChange={(event) =>
                      updateSelectedCampaign((campaign) => ({
                        ...campaign,
                        theme: { ...campaign.theme, headline: event.target.value }
                      }))
                    }
                  />
                </label>
                <label>
                  Email body
                  <textarea
                    value={selectedCampaign.theme.body}
                    onChange={(event) =>
                      updateSelectedCampaign((campaign) => ({
                        ...campaign,
                        theme: { ...campaign.theme, body: event.target.value }
                      }))
                    }
                  />
                </label>
                <label>
                  SMS copy
                  <textarea
                    value={selectedCampaign.theme.sms}
                    onChange={(event) =>
                      updateSelectedCampaign((campaign) => ({
                        ...campaign,
                        theme: { ...campaign.theme, sms: event.target.value }
                      }))
                    }
                  />
                </label>
              </div>
            </div>
          ) : null}

          <div className="action-row">
            <button className="save-button" onClick={() => void saveCampaign()} disabled={saving || !selectedCampaign}>
              {saving ? "Saving..." : "Save campaign"}
            </button>
            {selectedCampaign ? (
              <button className="ghost-button" onClick={() => void activateCampaign(selectedCampaign.id)} disabled={saving}>
                Make active
              </button>
            ) : null}
            {saveState ? <span className="status-line">{saveState}</span> : null}
          </div>
        </section>

        <section className="stack-column">
          <section className="card surface">
            <div className="section-head">
              <h3>Recovery Feed</h3>
              <span>Live failed-payment operations</span>
            </div>
            <div className="feed-list">
              {data.sessions.length === 0 ? (
                <div className="feed-empty">No failed sessions yet.</div>
              ) : (
                data.sessions.map((session) => (
                  <article key={session.id} className="feed-card">
                    <div>
                      <strong>{session.checkoutToken}</strong>
                      <p>{session.email || session.phone || "No reachable contact"}</p>
                    </div>
                    <div className="feed-meta">
                      <span>{formatCurrency(session.amountSubtotal || 0)}</span>
                      <span>{session.countryCode || "--"}</span>
                      <span className={`badge badge-${session.state.toLowerCase()}`}>{stateLabel(session.state)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="card surface">
            <div className="section-head">
              <h3>Merchant Controls</h3>
              <span>Platform defaults</span>
            </div>
            <div className="control-list">
              <div><span>Brand</span><strong>{data.settings.brandName}</strong></div>
              <div><span>Support</span><strong>{data.settings.supportEmail}</strong></div>
              <div><span>Email enabled</span><strong>{data.settings.sendEmail ? "Yes" : "No"}</strong></div>
              <div><span>SMS enabled</span><strong>{data.settings.sendSms ? "Yes" : "No"}</strong></div>
              <div><span>Default cadence</span><strong>{data.settings.retryMinutes.join(" / ")} min</strong></div>
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
