const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface TrackInfo {
  externalId: string;
  provider: string;
  status: string;
  feeCents: number;
  readySlot: string;
  kitchenName: string;
}

const STEPS = [
  { key: "created", label: "Order confirmed" },
  { key: "courier_assigned", label: "Courier assigned" },
  { key: "picked_up", label: "Picked up from kitchen" },
  { key: "delivered", label: "Delivered" },
];

async function getTracking(id: string): Promise<TrackInfo | null> {
  try {
    const res = await fetch(`${API}/track/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const info = await getTracking(id);
  const activeIndex = info ? Math.max(STEPS.findIndex((s) => s.key === info.status), 0) : 0;

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "14px 20px 60px" }}>

      {!info ? (
        <div className="fade-up" style={{ textAlign: "center", marginTop: "20vh" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Tracking link not found
          </h1>
          <p style={{ color: "var(--text-2)", fontSize: 15 }}>
            This delivery does not exist or the link has expired.
          </p>
        </div>
      ) : (
        <div className="fade-up shell" style={{ marginTop: 64 }}>
          <div className="shell-core" style={{ padding: "30px 28px" }}>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--accent)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Delivery tracking
            </p>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: "8px 0 4px" }}>
              {info.kitchenName}
            </h1>
            <p style={{ color: "var(--text-2)", fontSize: 14.5, margin: "0 0 30px" }}>
              Ready {new Date(info.readySlot).toLocaleString()} &middot; courier fee $
              {(info.feeCents / 100).toFixed(2)}
            </p>

            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {STEPS.map((step, i) => {
                const done = i <= activeIndex;
                const current = i === activeIndex;
                return (
                  <li key={step.key} style={{ display: "flex", gap: 16, minHeight: 56 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          marginTop: 3,
                          background: done ? "var(--accent)" : "var(--surface-2)",
                          border: done ? "none" : "2px solid var(--line)",
                          boxShadow: current ? "0 0 0 5px var(--accent-soft)" : "none",
                          flexShrink: 0,
                        }}
                      />
                      {i < STEPS.length - 1 && (
                        <span
                          style={{
                            width: 2,
                            flex: 1,
                            background: i < activeIndex ? "var(--accent)" : "var(--line)",
                            margin: "6px 0",
                          }}
                        />
                      )}
                    </div>
                    <div style={{ paddingBottom: 22 }}>
                      <div
                        style={{
                          fontWeight: current ? 700 : 600,
                          fontSize: 15.5,
                          color: done ? "var(--text)" : "var(--text-3)",
                        }}
                      >
                        {step.label}
                      </div>
                      {current && (
                        <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 3 }}>
                          {info.provider === "mock"
                            ? "Development courier (simulated)"
                            : `via ${info.provider}`}
                          {" "}&middot; #{info.externalId}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </main>
  );
}
