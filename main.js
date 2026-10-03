import React, { useState, useEffect } from "react";

const BACKEND_URL = "http://localhost:5000/api";

export default function SchoolBusPlanner() {
  const [graphData, setGraphData] = useState(null);
  const [solution, setSolution] = useState(null);
  const [dijkstraTrace, setDijkstraTrace] = useState(null);
  const [activeTab, setActiveTab] = useState("routes");
  const [alpha, setAlpha] = useState(1.0);
  const [beta, setBeta] = useState(2.0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND_URL}/graph`)
      .then((res) => res.json())
      .then((data) => setGraphData(data))
      .catch((err) => console.error("Error loading graph:", err));
  }, []);

  const runSolver = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alpha, beta }),
      });
      const data = await res.json();
      setSolution(data);
      setActiveTab("routes");
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const runDijkstra = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/dijkstra?source=DEPOT`);
      const data = await res.json();
      setDijkstraTrace(data);
      setActiveTab("dijkstra");
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  if (!graphData) return <div style={{ padding: 20 }}>Loading Network Graph...</div>;

  const routeColors = ["#2563eb", "#dc2626", "#059669"];

  return (
    <div style={{ display: "flex", fontFamily: "sans-serif", height: "100vh" }}>
      {/* MAP & CANVAS PANEL */}
      <div style={{ flex: 1.2, padding: 20, borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column" }}>
        <h2>School Bus Route Topology</h2>
        <div style={{ marginBottom: 12 }}>
          <button onClick={runSolver} disabled={loading} style={{ marginRight: 8, padding: "8px 16px" }}>
            {loading ? "Computing..." : "Run Greedy Solver"}
          </button>
          <button onClick={runDijkstra} disabled={loading} style={{ padding: "8px 16px" }}>
            Inspect Dijkstra State
          </button>
        </div>

        <svg viewBox="0 0 100 100" style={{ width: "100%", flex: 1, background: "#f8fafc", borderRadius: 8 }}>
          {/* Roads */}
          {graphData.roads.map((r, i) => {
            const u = graphData.stops[r.u];
            const v = graphData.stops[r.v];
            return (
              <g key={i}>
                <line x1={u.x} y1={u.y} x2={v.x} y2={v.y} stroke="#cbd5e1" strokeWidth="1.5" />
                <text x={(u.x + v.x) / 2} y={(u.y + v.y) / 2 - 1} fontSize="2.5" fill="#64748b" textAnchor="middle">
                  {r.dist}km
                </text>
              </g>
            );
          })}

          {/* Active Bus Tours */}
          {solution &&
            solution.routes.map((route, idx) => {
              const color = routeColors[idx % routeColors.length];
              return route.full_path_nodes.map((nodeId, i) => {
                if (i === 0) return null;
                const prev = graphData.stops[route.full_path_nodes[i - 1]];
                const curr = graphData.stops[nodeId];
                return (
                  <line
                    key={`${idx}-${i}`}
                    x1={prev.x}
                    y1={prev.y}
                    x2={curr.x}
                    y2={curr.y}
                    stroke={color}
                    strokeWidth="3"
                    strokeDasharray="2,1"
                  />
                );
              });
            })}

          {/* Stop Nodes */}
          {Object.entries(graphData.stops).map(([id, s]) => (
            <g key={id}>
              <circle
                cx={s.x}
                cy={s.y}
                r={s.is_depot ? 4 : 3}
                fill={s.is_depot ? "#0f172a" : s.priority === 1 ? "#ef4444" : "#f59e0b"}
              />
              <text x={s.x} y={s.y + 6} fontSize="3" fontWeight="bold" textAnchor="middle">
                {s.name} {!s.is_depot && `(P${s.priority})`}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* DECISION & METRICS PANEL */}
      <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
        <div style={{ display: "flex", gap: 10, borderBottom: "1px solid #ddd", paddingBottom: 10 }}>
          <button onClick={() => setActiveTab("routes")}>Routes & Fleet</button>
          <button onClick={() => setActiveTab("dijkstra")}>Dijkstra Trace</button>
        </div>

        {activeTab === "routes" && (
          <div>
            <h3>Generated Route Plans</h3>
            {!solution && <p>Click "Run Greedy Solver" to compute fleet assignments.</p>}
            {solution && (
              <>
                <p><strong>Total Distance:</strong> {solution.summary.total_distance_km} km</p>
                {solution.routes.map((rt, i) => (
                  <div key={i} style={{ border: `1px solid ${routeColors[i]}`, borderRadius: 6, padding: 12, marginBottom: 12 }}>
                    <h4 style={{ color: routeColors[i], margin: "0 0 8px 0" }}>
                      {rt.bus_name} (Capacity: {rt.passengers_carried}/{rt.capacity})
                    </h4>
                    <p><strong>Path:</strong> {rt.ordered_stops.join(" ➔ ")}</p>
                    <p><strong>Distance:</strong> {rt.total_route_distance_km} km | <strong>Utilization:</strong> {rt.utilization_pct}%</p>
                    <h5>Decision Trace:</h5>
                    <ul style={{ fontSize: 13, color: "#475569" }}>
                      {rt.decision_log.map((d, dIdx) => (
                        <li key={dIdx}>
                          {d.action}: +{d.distance_added_km} km (Priority {d.priority}, Onboard: {d.load_onboard}/{d.capacity})
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === "dijkstra" && dijkstraTrace && (
          <div>
            <h3>Dijkstra Step-by-Step State</h3>
            <p>Shortest paths starting from <strong>{dijkstraTrace.source}</strong>:</p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  <th style={{ padding: 6 }}>Step</th>
                  <th style={{ padding: 6 }}>Settled Node</th>
                  <th style={{ padding: 6 }}>Known Distance</th>
                </tr>
              </thead>
              <tbody>
                {dijkstraTrace.trace.map((step, idx) => (
                  <tr key={idx} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 6 }}>{idx + 1}</td>
                    <td style={{ padding: 6 }}>{step.settled_node}</td>
                    <td style={{ padding: 6 }}>{step.distance} km</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}