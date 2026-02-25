import "./styles.css";

const metricCards = [
  { label: "Detected Failed Payments", value: "4,230" },
  { label: "Recovered Orders", value: "612" },
  { label: "Recovered Revenue", value: "$1,880" },
  { label: "Recovery Rate", value: "14.5%" }
];

export function App() {
  return (
    <main className="layout">
      <header className="hero">
        <p className="kicker">Failed Payment Recovery</p>
        <h1>Recover revenue that silently dies at checkout.</h1>
        <p>
          Detect likely payment failures, trigger branded retries, and track exactly what you win back.
        </p>
      </header>

      <section className="metrics">
        {metricCards.map((card) => (
          <article key={card.label} className="card">
            <p>{card.label}</p>
            <h2>{card.value}</h2>
          </article>
        ))}
      </section>

      <section className="timeline card wide">
        <h3>Retry Policy</h3>
        <ul>
          <li>Attempt 1: 15 minutes</li>
          <li>Attempt 2: 6 hours</li>
          <li>Attempt 3: 24 hours</li>
        </ul>
      </section>
    </main>
  );
}
