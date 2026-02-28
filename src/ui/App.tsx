import { useEffect, useMemo, useState } from "react";
import "./styles.css";

type SessionState = "LIKELY_FAILED_PAYMENT" | "RECOVERED" | "EXPIRED" | "UNSUBSCRIBED" | "PENDING";

interface DashboardPayload {
  metrics: {
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
  sessions: Array<{
    id: string;
    checkoutToken: string;
    email?: string;
    phone?: string;
    amountSubtotal?: number;
    state: SessionState;
    attemptCount: number;
    failedAt?: string;
    lastAttemptAt?: string;
    nextAttemptAt?: string;
  }>;
}

const emptyPayload: DashboardPayload = {
  metrics: {
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
  sessions: []
};

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function labelForState(state: SessionState): string {
  switch (state) {
    case "LIKELY_FAILED_PAYMENT":
      return "Recovering";
    case "RECOVERED":
      return "Recovered";
    case "EXPIRED":
      return "Expired";
    case "UNSUBSCRIBED":
      return "Unsubscribed";
    default:
      return "Pending";
  }
}

export function App() {
  const appConfig = window.__APP_CONFIG__;
  const [data, setData] = useState<DashboardPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    async function load() {
      const response = await fetch("/dashboard");
      const payload = (await response.json()) as DashboardPayload;
      setData(payload);
      setLoading(false);
    }

    load().catch(() => {
      setLoading(false);
      setStatus("Could not load live dashboard data.");
    });
  }, []);

  const metricCards = useMemo(
    () => [
      { label: "Detected failures", value: String(data.metrics.detected), tone: "default" },
      { label: "Recovered orders", value: String(data.metrics.recovered), tone: "success" },
      { label: "Recovered revenue", value: formatCurrency(data.metrics.recoveredRevenue), tone: "success" },
      { label: "At-risk revenue", value: formatCurrency(data.metrics.pendingRevenue), tone: "warning" },
      { label: "Recovery rate", value: `${data.metrics.recoveryRate}%`, tone: "default" }
    ],
    [data.metrics]
  );

  async function saveSettings() {
    setSaving(true);
    setStatus("");
    const response = await fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data.settings)
    });

    if (!response.ok) {
      setStatus("Settings update failed.");
      setSaving(false);
      return;
    }

    const updated = (await response.json()) as DashboardPayload["settings"];
    setData((current) => ({ ...current, settings: updated }));
    setSaving(false);
    setStatus("Settings saved.");
  }

  return (
    <main className="layout">
      <header className="hero" style={{ borderTopColor: data.settings.accentColor }}>
        <div>
          <p className="kicker">Failed Payment Recovery</p>
          <h1>Recover one-time checkout revenue with disciplined retries.</h1>
          <p className="hero-copy">
            Watch failed payment sessions in real time, trigger branded outreach, and see exact revenue recovered.
          </p>
        </div>
        <div className="hero-side">
          <span className="pill">
            {loading ? "Loading" : `${data.metrics.active} live recoveries`}
          </span>
          <p>{appConfig?.embedded ? "Embedded in Shopify Admin" : "Standalone app view"}</p>
          <p>Brand: {data.settings.brandName}</p>
          <p>Store: {appConfig?.shop || "Not connected"}</p>
          <p>Support: {data.settings.supportEmail}</p>
        </div>
      </header>

      <section className="metrics">
        {metricCards.map((card) => (
          <article key={card.label} className={`card metric metric-${card.tone}`}>
            <p>{card.label}</p>
            <h2>{card.value}</h2>
          </article>
        ))}
      </section>

      <section className="grid-two">
        <section className="card panel">
          <div className="section-head">
            <h3>Recovery Queue</h3>
            <span>{data.sessions.length} recent sessions</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Checkout</th>
                  <th>Contact</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="empty-row">
                      No failed payment sessions yet.
                    </td>
                  </tr>
                ) : (
                  data.sessions.map((session) => (
                    <tr key={session.id}>
                      <td>
                        <strong>{session.checkoutToken}</strong>
                        <span>{session.failedAt ? new Date(session.failedAt).toLocaleString() : "-"}</span>
                      </td>
                      <td>{session.email || session.phone || "No contact"}</td>
                      <td>{formatCurrency(session.amountSubtotal || 0)}</td>
                      <td>
                        <span className={`badge badge-${session.state.toLowerCase()}`}>{labelForState(session.state)}</span>
                      </td>
                      <td>{session.attemptCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card panel settings-panel">
          <div className="section-head">
            <h3>Campaign Settings</h3>
            <span>Live configuration</span>
          </div>

          <label>
            Brand name
            <input
              value={data.settings.brandName}
              onChange={(event) =>
                setData((current) => ({
                  ...current,
                  settings: { ...current.settings, brandName: event.target.value }
                }))
              }
            />
          </label>

          <label>
            Support email
            <input
              value={data.settings.supportEmail}
              onChange={(event) =>
                setData((current) => ({
                  ...current,
                  settings: { ...current.settings, supportEmail: event.target.value }
                }))
              }
            />
          </label>

          <label>
            Accent color
            <div className="color-row">
              <input
                type="color"
                value={data.settings.accentColor}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    settings: { ...current.settings, accentColor: event.target.value }
                  }))
                }
              />
              <code>{data.settings.accentColor}</code>
            </div>
          </label>

          <label>
            Retry schedule (minutes)
            <input
              value={data.settings.retryMinutes.join(",")}
              onChange={(event) => {
                const retryMinutes = event.target.value
                  .split(",")
                  .map((item) => Number(item.trim()))
                  .filter((item) => Number.isFinite(item) && item > 0);

                setData((current) => ({
                  ...current,
                  settings: { ...current.settings, retryMinutes }
                }));
              }}
            />
          </label>

          <div className="toggle-row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={data.settings.sendEmail}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    settings: { ...current.settings, sendEmail: event.target.checked }
                  }))
                }
              />
              <span>Email recovery</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={data.settings.sendSms}
                onChange={(event) =>
                  setData((current) => ({
                    ...current,
                    settings: { ...current.settings, sendSms: event.target.checked }
                  }))
                }
              />
              <span>SMS recovery</span>
            </label>
          </div>

          <button className="save-button" onClick={() => void saveSettings()} disabled={saving || loading}>
            {saving ? "Saving..." : "Save settings"}
          </button>
          {status ? <p className="status-line">{status}</p> : null}
        </section>
      </section>
    </main>
  );
}
