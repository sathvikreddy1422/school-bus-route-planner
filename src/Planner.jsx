import React, { useEffect, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";

const API = "http://127.0.0.1:5000/api";
const COLORS = ["#e7643d", "#167d78", "#5267b4", "#a36e19"];
const HYDERABAD_CENTER = [17.385, 78.4867];
const toLatLng = (stop) => [stop.latitude, stop.longitude];

function makeBusIcon(color) {
  return L.divIcon({
    className: "bus-marker-wrap",
    html: `<span class="bus-marker-icon" style="--bus-color:${color}"><svg viewBox="0 0 32 22" aria-hidden="true"><path d="M5 2.5h18a4 4 0 0 1 4 4v9h2v3h-3a3 3 0 0 1-6 0h-8a3 3 0 0 1-6 0H3v-3h2V6.5a4 4 0 0 1 4-4Z"/><path class="bus-window" d="M8 5h6v5H8zm8 0h7a2 2 0 0 1 2 2v3h-9z"/><circle class="bus-wheel" cx="9" cy="17" r="1.8"/><circle class="bus-wheel" cx="23" cy="17" r="1.8"/></svg></span>`,
    iconSize: [32, 24],
    iconAnchor: [16, 12],
  });
}

async function requestJson(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export default function Planner() {
  const [graph, setGraph] = useState(null);
  const [plan, setPlan] = useState(null);
  const [trace, setTrace] = useState(null);
  const [progress, setProgress] = useState({});
  const [selectedBus, setSelectedBus] = useState(null);
  const [view, setView] = useState("fleet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ name: "", demand: "3", priority: "2" });
  const [schoolDirectory, setSchoolDirectory] = useState([]);
  const [locationQuery, setLocationQuery] = useState("");
  const [placeResults, setPlaceResults] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [schoolDataSource, setSchoolDataSource] = useState("");
  const [placeSearchBusy, setPlaceSearchBusy] = useState(false);

  const loadGraph = async () => {
    const data = await requestJson(await fetch(`${API}/graph`));
    setGraph(data);
  };

  const calculatePlan = async () => {
    const data = await requestJson(await fetch(`${API}/solve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alpha: 1, beta: 2 }),
    }));
    const geometry = await requestJson(await fetch(`${API}/routes/geometry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routes: data.routes.map((item) => ({ bus_id: item.bus_id, stop_ids: item.full_path_nodes })) }),
    }));
    setPlan({
      ...data,
      routes: data.routes.map((item) => ({ ...item, ...geometry.routes[item.bus_id] })),
    });
    setSelectedBus((current) => current || data.routes[0]?.bus_id || null);
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        await loadGraph();
        try {
          await requestJson(await fetch(`${API}/roads/refresh`, { method: "POST" }));
        } catch (problem) {
          setError(`Using saved road costs: ${problem.message}`);
        }
        await calculatePlan();
      } catch (problem) {
        setError(problem.message);
      }
    };
    initialize();

    fetch(`${API}/schools`)
      .then(requestJson)
      .then((data) => {
        setSchoolDirectory(data.schools);
        setSchoolDataSource(`${data.count} mapped schools · OpenStreetMap`);
      })
      .catch(() => setSchoolDataSource("School directory temporarily unavailable"));
  }, []);

  useEffect(() => {
    const query = locationQuery.trim();
    const normalizedQuery = query.toLocaleLowerCase();
    const mappedSchools = schoolDirectory
      .filter((school) => `${school.name} ${school.locality}`.toLocaleLowerCase().includes(normalizedQuery))
      .slice(0, 6)
      .map((school) => ({ ...school, display_name: `${school.name}, ${school.locality}, Hyderabad` }));

    if (query.length < 3) {
      setPlaceResults(mappedSchools);
      setPlaceSearchBusy(false);
      return undefined;
    }

    setPlaceResults(mappedSchools);
    const timer = window.setTimeout(async () => {
      setPlaceSearchBusy(true);
      try {
        const result = await requestJson(await fetch(`${API}/places?q=${encodeURIComponent(query)}`));
        const seenLocations = new Set(mappedSchools.map((place) => `${place.latitude},${place.longitude}`));
        const additionalPlaces = result.places.filter((place) => {
          const key = `${place.latitude},${place.longitude}`;
          if (seenLocations.has(key)) return false;
          seenLocations.add(key);
          return true;
        });
        setPlaceResults([...mappedSchools, ...additionalPlaces].slice(0, 8));
      } catch {
        setPlaceResults(mappedSchools);
      } finally {
        setPlaceSearchBusy(false);
      }
    }, 650);
    return () => window.clearTimeout(timer);
  }, [locationQuery, schoolDirectory]);

  useEffect(() => {
    if (!plan?.routes?.length) return undefined;
    setProgress(Object.fromEntries(plan.routes.map((route) => [route.bus_id, 0])));
    const timer = window.setInterval(() => {
      setProgress((current) => Object.fromEntries(plan.routes.map((route) => {
        const next = (current[route.bus_id] || 0) + 0.12;
        return [route.bus_id, next >= route.full_path_nodes.length - 1 ? 0 : next];
      })));
    }, 700);
    return () => window.clearInterval(timer);
  }, [plan]);

  const refreshPlan = async () => {
    setBusy(true);
    setError("");
    try {
      await Promise.all([loadGraph(), calculatePlan()]);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  const addStop = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson(await fetch(`${API}/stops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          latitude: selectedPlace.latitude,
          longitude: selectedPlace.longitude,
          demand: Number(form.demand),
          priority: Number(form.priority),
        }),
      }));
      await Promise.all([loadGraph(), calculatePlan()]);
      setNotice(`${result.stop.name} added to the Hyderabad road network. Routes recalculated.`);
      setForm((current) => ({ ...current, name: "" }));
      setLocationQuery("");
      setSelectedPlace(null);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  const inspectPaths = async () => {
    setBusy(true);
    setError("");
    try {
      setTrace(await requestJson(await fetch(`${API}/dijkstra?source=DEPOT`)));
      setView("paths");
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  };

  if (!graph || !plan) return <main className="loading-screen">{error || "Connecting to route control…"}</main>;

  const route = plan.routes.find((item) => item.bus_id === selectedBus) || plan.routes[0];
  const activeStopId = route?.full_path_nodes[Math.floor(progress[route.bus_id] || 0) + 1];
  const activeStop = graph.stops[activeStopId]?.name || "Starting route";
  const positionFor = (item) => {
    const coordinates = item.coordinates || [];
    if (coordinates.length < 2) return toLatLng(graph.stops.DEPOT);
    const amount = progress[item.bus_id] || 0;
    const leg = Math.min(Math.floor(amount), coordinates.length - 2);
    const portion = amount - leg;
    const from = coordinates[leg];
    const to = coordinates[leg + 1];
    return [from[0] + (to[0] - from[0]) * portion, from[1] + (to[1] - from[1]) * portion];
  };

  const pickupCount = Object.values(graph.stops).filter((stop) => !stop.is_depot).length;

  return <main className="planner-shell">
    <header className="topbar">
      <a className="brand" href="#top"><span className="brand-mark">R</span><span>ROUTE<span className="brand-light">DESK</span></span></a>
      <div className="topbar-right"><span className="service-label">HYDERABAD · TG <i /></span><span className="day-label">TELANGANA / INDIA</span></div>
    </header>

    <section className="page-heading" id="top">
      <div><p className="eyebrow">SCHOOL TRANSPORT / CONTROL ROOM</p><h1>Route overview<span className="heading-period">.</span></h1><p className="subheading">Fleet position and pickup assignments for today’s service.</p></div>
      <div className="service-status"><span className="pulse-dot" /> OSRM ROAD SIMULATION</div>
    </section>

    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {notice && <div className="alert alert-success" role="status">{notice}</div>}

    <section className="metric-strip" aria-label="Route summary">
      <div className="metric"><span className="metric-label">BUSES ON ROUTE</span><strong>{String(plan.routes.length).padStart(2, "0")}</strong></div>
      <div className="metric"><span className="metric-label">PICKUP STOPS</span><strong>{String(pickupCount).padStart(2, "0")}</strong></div>
      <div className="metric"><span className="metric-label">FLEET DISTANCE</span><strong>{plan.summary.total_distance_km}<small> km</small></strong></div>
      <div className="metric metric-end"><span className="metric-label">UNASSIGNED</span><strong>{String(plan.summary.unserved_stops.length).padStart(2, "0")}</strong></div>
    </section>

    <section className="workspace-grid">
      <section className="map-section" aria-label="Route map">
        <div className="section-heading map-heading"><div><p className="eyebrow">NETWORK MAP</p><h2>Fleet in motion</h2></div><button className="quiet-button" onClick={refreshPlan} disabled={busy}><span aria-hidden="true">↻</span> Recalculate</button></div>
        <div className="map-meta"><span><i className="legend-road" /> ROAD NETWORK</span><span><i className="legend-route" /> ACTIVE ROUTE</span><span><i className="legend-bus" /> MOVING BUS</span></div>
        <div className="map-frame">
          <MapContainer className="satellite-map" center={HYDERABAD_CENTER} zoom={12} minZoom={10} maxZoom={19} scrollWheelZoom={false}>
            <TileLayer
              attribution="Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
            {graph.roads.map((road, index) => <Polyline
              key={`road-${index}`}
              positions={[toLatLng(graph.stops[road.u]), toLatLng(graph.stops[road.v])]}
              pathOptions={{ color: "#f3f0d4", opacity: 0.72, weight: 3, dashArray: "2 7" }}
            />)}
            {plan.routes.map((item, index) => <Polyline
              key={item.bus_id}
              positions={item.coordinates}
              pathOptions={{ color: COLORS[index % COLORS.length], opacity: item.bus_id === selectedBus ? 0.96 : 0.62, weight: item.bus_id === selectedBus ? 5 : 3 }}
            />)}
            {Object.entries(graph.stops).map(([id, stop]) => <CircleMarker
              key={id}
              center={toLatLng(stop)}
              radius={stop.is_depot ? 8 : 6}
              pathOptions={{ color: "#fff", weight: 2, fillColor: stop.is_depot ? "#203a32" : "#e7643d", fillOpacity: 1 }}
            ><Popup><strong>{stop.name}</strong>{!stop.is_depot && <><br />Priority {stop.priority} · {stop.demand} students</>}</Popup></CircleMarker>)}
            {plan.routes.map((item, index) => <Marker
              key={`bus-${item.bus_id}`}
              position={positionFor(item)}
              icon={makeBusIcon(COLORS[index % COLORS.length])}
              eventHandlers={{ click: () => setSelectedBus(item.bus_id) }}
            ><Popup>{graph.stops[item.full_path_nodes[Math.floor(progress[item.bus_id] || 0) + 1]]?.name || "Returning to depot"}</Popup></Marker>)}
          </MapContainer>
          <div className="map-footer"><span>HYDERABAD · TELANGANA · INDIA</span><span>OSRM DRIVING ROUTES / {graph.roads.length} LINKS</span></div>
        </div>
        <div className="map-note"><span className="note-symbol">i</span> Streets and school locations come from OpenStreetMap; buses animate along planned road routes. GPS vehicle feeds are not connected.</div>
      </section>

      <aside className="dispatch-rail">
        <div className="section-heading rail-heading"><div><p className="eyebrow">DISPATCH</p><h2>Fleet status</h2></div><span className="live-chip"><i /> SIM</span></div>
        <div className="view-switch" role="tablist" aria-label="Dispatch view"><button className={view === "fleet" ? "selected" : ""} onClick={() => setView("fleet")}>Fleet</button><button className={view === "paths" ? "selected" : ""} onClick={inspectPaths} disabled={busy}>Shortest paths</button></div>
        {view === "fleet" ? <div className="fleet-list">{plan.routes.map((item, index) => {
          const isSelected = item.bus_id === selectedBus;
          return <button className={`fleet-row ${isSelected ? "fleet-row-selected" : ""}`} key={item.bus_id} onClick={() => setSelectedBus(item.bus_id)}>
            <span className="fleet-color" style={{ "--bus-color": COLORS[index % COLORS.length] }} /><span className="fleet-info"><span className="fleet-title">Vehicle {index + 1}<small>{item.bus_id}</small></span><span className="fleet-subtitle">En route to {isSelected ? activeStop : graph.stops[item.ordered_stops[1]]?.name || "depot"}</span><span className="capacity-track"><i style={{ width: `${item.utilization_pct}%`, "--bus-color": COLORS[index % COLORS.length] }} /></span></span><span className="fleet-capacity">{item.passengers_carried}<small>/{item.capacity}</small></span>
          </button>;
        })}</div> : <div className="trace-panel"><div className="trace-intro">Dijkstra from depot. Nodes settle in increasing shortest-path distance.</div>{trace?.trace.map((step, index) => <div className="trace-row" key={step.settled_node}><span className="trace-index">{String(index + 1).padStart(2, "0")}</span><span>{graph.stops[step.settled_node]?.name}</span><strong>{step.distance} km</strong></div>)}</div>}

        <section className="selected-route"><div className="mini-section-title"><span>ACTIVE ASSIGNMENT</span><span>{route?.utilization_pct}% FULL</span></div><div className="assignment-path">{route?.ordered_stops.map((stopId, index) => <React.Fragment key={`${stopId}-${index}`}>{index > 0 && <span className="path-arrow">›</span>}<span>{graph.stops[stopId]?.name || stopId}</span></React.Fragment>)}</div><div className="assignment-distance"><span>Planned distance</span><strong>{route?.total_route_distance_km} km</strong></div></section>

        <section className="add-stop-section">
          <div className="add-stop-heading"><div><p className="eyebrow">NETWORK EDIT</p><h3>Add a pickup stop</h3></div><span className="plus-mark">+</span></div>
          <form className="stop-form" onSubmit={addStop}>
            <div className="field field-wide place-search-field">
              <label htmlFor="place-search">SCHOOL OR PLACE NAME</label>
              <input id="place-search" type="search" autoComplete="off" required value={locationQuery} onChange={(event) => { setLocationQuery(event.target.value); setSelectedPlace(null); }} placeholder="Search Hyderabad schools or places" />
              {placeSearchBusy && <span className="place-search-status">SEARCHING OPENSTREETMAP…</span>}
              {!selectedPlace && locationQuery.trim().length >= 3 && <div className="place-results" role="listbox" aria-label="Hyderabad place results">
                {placeResults.map((place) => <button type="button" role="option" className="place-result" key={`${place.latitude}-${place.longitude}`} onClick={() => { setSelectedPlace(place); setForm((current) => ({ ...current, name: place.name })); setPlaceResults([]); }}>
                  <strong>{place.name}</strong><span>{place.locality || place.display_name}</span>
                </button>)}
                {!placeSearchBusy && placeResults.length === 0 && <span className="place-no-results">No mapped places found in Hyderabad.</span>}
              </div>}
              {selectedPlace && <span className="selected-place-note">Selected · {selectedPlace.locality || "Hyderabad"}</span>}
              {schoolDataSource && <span className="school-source-note">{schoolDataSource}</span>}
            </div>
            <label className="field">STUDENTS<input type="number" min="1" max="15" required value={form.demand} onChange={(event) => setForm({ ...form, demand: event.target.value })} /></label>
            <label className="field">PRIORITY<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="1">P1 · Urgent</option><option value="2">P2 · High</option><option value="3">P3 · Standard</option><option value="4">P4 · Low</option><option value="5">P5 · Flexible</option></select></label>
            <div className="field-wide road-link-note">Stop connects to its nearest existing stop by the fastest available driving route.</div>
            <button className="add-stop-button" type="submit" disabled={busy || !selectedPlace}>{busy ? "UPDATING ROUTES…" : "ADD STOP & RECALCULATE"}<span>↗</span></button>
          </form>
        </section>
      </aside>
    </section>
    <footer className="page-footer"><span>ROUTEDESK <i>·</i> SCHOOL TRANSPORT PLANNING</span><span>GREEDY CAPACITY ASSIGNMENT <i>·</i> DIJKSTRA ROAD COSTS <i>·</i> BFS CONNECTIVITY</span></footer>
  </main>;
}