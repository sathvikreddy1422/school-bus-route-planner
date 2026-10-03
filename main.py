from flask import Flask, request, jsonify
from flask_cors import CORS
import heapq
import math
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import deque
from typing import Dict, List, Tuple, Optional

app = Flask(__name__)
CORS(app)

class SchoolBusRoutePlanner:
    def __init__(self):
        self.stops = {
            "DEPOT": {"name": "Demo Depot · Hyderabad", "latitude": 17.385000, "longitude": 78.486700, "x": 50, "y": 50, "demand": 0, "priority": 0, "is_depot": True},
            "STOP_1": {"name": "Gautham Model School", "latitude": 17.442728, "longitude": 78.445356, "x": 25, "y": 30, "demand": 4, "priority": 1, "is_depot": False},
            "STOP_2": {"name": "Jingle Bell School", "latitude": 17.395731, "longitude": 78.488434, "x": 20, "y": 70, "demand": 5, "priority": 2, "is_depot": False},
            "STOP_3": {"name": "Holy Mary Girls High School", "latitude": 17.404402, "longitude": 78.457813, "x": 45, "y": 85, "demand": 6, "priority": 1, "is_depot": False},
            "STOP_4": {"name": "St. Joseph's High School", "latitude": 17.393758, "longitude": 78.452494, "x": 75, "y": 75, "demand": 5, "priority": 3, "is_depot": False},
            "STOP_5": {"name": "Nasr School", "latitude": 17.411373, "longitude": 78.458829, "x": 80, "y": 35, "demand": 4, "priority": 2, "is_depot": False}
        }
        self.buses = [
            {"id": "BUS_1", "name": "Bus A", "capacity": 12},
            {"id": "BUS_2", "name": "Bus B", "capacity": 15}
        ]
        self.roads = [
            ("DEPOT", "STOP_1", 4.2),
            ("STOP_1", "STOP_2", 3.1),
            ("STOP_2", "STOP_3", 3.8),
            ("STOP_3", "DEPOT", 5.0),
            ("DEPOT", "STOP_5", 3.9),
            ("STOP_5", "STOP_4", 3.5),
            ("STOP_4", "STOP_3", 4.0),
            ("STOP_1", "STOP_3", 6.5)
        ]
        self.adj = self._build_adjacency()

    def add_stop(
        self,
        name: str,
        demand: int,
        priority: int,
        connected_to: str,
        distance_km: float,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> dict:
        stop_numbers = [
            int(stop_id.removeprefix("STOP_"))
            for stop_id in self.stops
            if stop_id.startswith("STOP_") and stop_id.removeprefix("STOP_").isdigit()
        ]
        stop_number = max(stop_numbers, default=0) + 1
        stop_id = f"STOP_{stop_number}"
        anchor = self.stops[connected_to]
        angle = stop_number * 2.399963
        x = min(92, max(8, anchor["x"] + 13 * math.cos(angle)))
        y = min(92, max(8, anchor["y"] + 13 * math.sin(angle)))
        stop = {
            "name": name,
            "x": round(x, 1),
            "y": round(y, 1),
            "demand": demand,
            "priority": priority,
            "is_depot": False,
            "connected_to": connected_to,
        }
        if latitude is not None and longitude is not None:
            stop["latitude"] = latitude
            stop["longitude"] = longitude

        self.stops[stop_id] = stop
        self.roads.append((connected_to, stop_id, distance_km))
        self.adj[stop_id] = [(connected_to, distance_km)]
        self.adj[connected_to].append((stop_id, distance_km))
        return {"id": stop_id, **stop}

    def _build_adjacency(self) -> Dict[str, List[Tuple[str, float]]]:
        adj = {k: [] for k in self.stops}
        for u, v, w in self.roads:
            adj[u].append((v, w))
            adj[v].append((u, w))
        return adj

    # 1. BREADTH-FIRST SEARCH (Reachability & Component Discovery)
    def run_bfs(self, start_node: str = "DEPOT") -> dict:
        visited = {start_node}
        queue = deque([(start_node, 0)])
        order = []

        while queue:
            curr, hops = queue.popleft()
            order.append({"node": curr, "hops": hops, "name": self.stops[curr]["name"]})
            for neighbor, _ in self.adj.get(curr, []):
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, hops + 1))

        unreachable = [s for s in self.stops if s not in visited]
        return {
            "connected_stops": order,
            "unreachable_stops": unreachable,
            "total_reachable": len(visited)
        }

    # 2. DIJKSTRA'S ALGORITHM (Shortest Path & Tentative Costs)
    def run_dijkstra(self, source: str = "DEPOT") -> Tuple[Dict[str, float], Dict[str, Optional[str]], List[dict]]:
        distances = {node: float("inf") for node in self.stops}
        previous = {node: None for node in self.stops}
        distances[source] = 0.0
        pq = [(0.0, source)]
        step_trace = []

        while pq:
            d, u = heapq.heappop(pq)
            if d > distances[u]:
                continue

            step_trace.append({
                "settled_node": u,
                "distance": round(d, 2),
                "tentative_snapshot": {k: (round(v, 2) if v != float("inf") else None) for k, v in distances.items()}
            })

            for v, weight in self.adj.get(u, []):
                alt = d + weight
                if alt < distances[v]:
                    distances[v] = alt
                    previous[v] = u
                    heapq.heappush(pq, (alt, v))

        return distances, previous, step_trace

    def _reconstruct_path(self, previous: Dict[str, Optional[str]], target: str) -> List[str]:
        path = []
        curr = target
        while curr:
            path.append(curr)
            curr = previous[curr]
        return path[::-1]

    # 3. GREEDY MULTI-VEHICLE CVRP SOLVER
    def solve_routes(self, alpha: float = 1.0, beta: float = 2.0) -> dict:
        # Precompute All-Pairs Shortest Paths via Dijkstra
        all_dist = {}
        all_pred = {}
        for s in self.stops:
            dist, pred, _ = self.run_dijkstra(s)
            all_dist[s] = dist
            all_pred[s] = pred

        unvisited = {s for s, data in self.stops.items() if not data["is_depot"]}
        fleet_routes = []
        total_fleet_dist = 0.0

        for bus in self.buses:
            if not unvisited:
                break

            current_node = "DEPOT"
            current_load = 0
            route_stops = ["DEPOT"]
            route_distance = 0.0
            detailed_steps = []
            decision_log = []

            while True:
                best_stop = None
                best_score = float("inf")
                best_leg_dist = float("inf")

                # Local Greedy Choice
                for candidate in sorted(unvisited):
                    demand = self.stops[candidate]["demand"]
                    if current_load + demand <= bus["capacity"]:
                        dist = all_dist[current_node][candidate]
                        prio = self.stops[candidate]["priority"]
                        # Score: smaller distance and higher priority (low number) yield better score
                        score = (alpha * dist) - (beta * (6 - prio))
                        if score < best_score:
                            best_score = score
                            best_leg_dist = dist
                            best_stop = candidate

                if best_stop is None:
                    break

                # Record decision and advance
                unvisited.remove(best_stop)
                current_load += self.stops[best_stop]["demand"]
                route_distance += best_leg_dist
                route_stops.append(best_stop)

                leg_path = self._reconstruct_path(all_pred[current_node], best_stop)
                if detailed_steps:
                    detailed_steps.extend(leg_path[1:])
                else:
                    detailed_steps.extend(leg_path)

                decision_log.append({
                    "action": f"Visited {self.stops[best_stop]['name']}",
                    "stop_id": best_stop,
                    "distance_added_km": round(best_leg_dist, 2),
                    "selection_score": round(best_score, 2),
                    "load_onboard": current_load,
                    "capacity": bus["capacity"],
                    "priority": self.stops[best_stop]["priority"]
                })
                current_node = best_stop

            # Return vehicle to depot
            return_dist = all_dist[current_node]["DEPOT"]
            route_distance += return_dist
            route_stops.append("DEPOT")
            return_path = self._reconstruct_path(all_pred[current_node], "DEPOT")
            if detailed_steps:
                detailed_steps.extend(return_path[1:])
            else:
                detailed_steps.extend(return_path)

            total_fleet_dist += route_distance
            fleet_routes.append({
                "bus_id": bus["id"],
                "bus_name": bus["name"],
                "capacity": bus["capacity"],
                "passengers_carried": current_load,
                "utilization_pct": round((current_load / bus["capacity"]) * 100, 1),
                "total_route_distance_km": round(route_distance, 2),
                "ordered_stops": route_stops,
                "full_path_nodes": detailed_steps,
                "decision_log": decision_log
            })

        return {
            "summary": {
                "total_distance_km": round(total_fleet_dist, 2),
                "buses_deployed": len(fleet_routes),
                "unserved_stops": list(unvisited)
            },
            "routes": fleet_routes
        }

planner = SchoolBusRoutePlanner()
school_cache = {"expires_at": 0.0, "schools": []}
school_cache_lock = threading.Lock()
place_cache = {}
place_cache_lock = threading.Lock()
last_place_request = 0.0

HYDERABAD_BOUNDS = (17.20, 78.20, 17.60, 78.70)

def _osrm_request(service: str, coordinates: List[Tuple[float, float]], options: str) -> dict:
    coordinate_path = ";".join(f"{longitude},{latitude}" for longitude, latitude in coordinates)
    url = f"https://router.project-osrm.org/{service}/v1/driving/{coordinate_path}?{options}"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "AlgoForgeSchoolBusPlanner/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            payload = json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError("OpenStreetMap road routing is temporarily unavailable") from error
    if payload.get("code") != "Ok":
        raise RuntimeError("No drivable road route was found for these locations")
    return payload

def _fetch_hyderabad_schools() -> List[dict]:
    now = time.monotonic()
    if school_cache["expires_at"] > now:
        return school_cache["schools"]

    south, west, north, east = HYDERABAD_BOUNDS
    query = (
        "[out:json][timeout:45];("
        f'nwr["amenity"="school"]({south},{west},{north},{east});'
        f'nwr["building"="school"]({south},{west},{north},{east});'
        ");out center tags;"
    )
    body = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "AlgoForgeSchoolBusPlanner/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=55) as response:
            payload = json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        raise RuntimeError("OpenStreetMap school data is temporarily unavailable") from error

    schools = []
    seen = set()
    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        name = tags.get("name")
        point = element.get("center", element)
        if not name or "lat" not in point or "lon" not in point:
            continue
        school_id = f"{element.get('type')}:{element.get('id')}"
        if school_id in seen:
            continue
        seen.add(school_id)
        locality = tags.get("addr:suburb") or tags.get("addr:city") or tags.get("addr:street") or "Hyderabad"
        schools.append({
            "id": school_id,
            "name": name,
            "locality": locality,
            "latitude": float(point["lat"]),
            "longitude": float(point["lon"]),
        })

    schools.sort(key=lambda school: school["name"].casefold())
    school_cache["schools"] = schools
    school_cache["expires_at"] = time.monotonic() + 21600
    return schools

@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({"status": "ok", "service": "school-bus-route-planner"})

@app.route("/api/graph", methods=["GET"])
def get_graph():
    return jsonify({
        "stops": planner.stops,
        "roads": [{"u": u, "v": v, "dist": w} for u, v, w in planner.roads],
        "buses": planner.buses
    })

@app.route("/api/schools", methods=["GET"])
def api_schools():
    try:
        schools = _fetch_hyderabad_schools()
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 502
    return jsonify({"source": "OpenStreetMap", "count": len(schools), "schools": schools})

@app.route("/api/roads/refresh", methods=["POST"])
def api_refresh_roads():
    node_ids = list(planner.stops)
    coordinates = [
        (planner.stops[node_id]["longitude"], planner.stops[node_id]["latitude"])
        for node_id in node_ids
    ]
    coordinate_path = ";".join(f"{longitude},{latitude}" for longitude, latitude in coordinates)
    url = f"https://router.project-osrm.org/table/v1/driving/{coordinate_path}?annotations=distance"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "AlgoForgeSchoolBusPlanner/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            payload = json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        return jsonify({"error": "OpenStreetMap road-distance service is temporarily unavailable"}), 502
    if payload.get("code") != "Ok":
        return jsonify({"error": "Unable to calculate road distances for the current stops"}), 502

    node_indexes = {node_id: index for index, node_id in enumerate(node_ids)}
    measured_roads = []
    for source, target, _ in planner.roads:
        distance = payload["distances"][node_indexes[source]][node_indexes[target]]
        if distance is None or distance <= 0:
            return jsonify({"error": f"No drivable road found between {source} and {target}"}), 502
        measured_roads.append((source, target, round(distance / 1000, 3)))

    planner.roads = measured_roads
    planner.adj = planner._build_adjacency()
    return jsonify({"updated_roads": len(measured_roads), "source": "OSRM driving network"})

@app.route("/api/routes/geometry", methods=["POST"])
def api_route_geometry():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("routes"), list):
        return jsonify({"error": "Request body must contain a routes array"}), 400

    geometries = {}
    try:
        for route in data["routes"]:
            bus_id = route.get("bus_id")
            stop_ids = route.get("stop_ids")
            if not isinstance(bus_id, str) or not isinstance(stop_ids, list) or len(stop_ids) < 2:
                return jsonify({"error": "Each route requires a bus ID and at least two stop IDs"}), 400
            if any(stop_id not in planner.stops for stop_id in stop_ids):
                return jsonify({"error": f"Route {bus_id} contains an unknown stop"}), 400
            coordinates = [
                (planner.stops[stop_id]["longitude"], planner.stops[stop_id]["latitude"])
                for stop_id in stop_ids
            ]
            payload = _osrm_request("route", coordinates, "overview=full&geometries=geojson&steps=false")
            result = payload["routes"][0]
            geometries[bus_id] = {
                "coordinates": [[latitude, longitude] for longitude, latitude in result["geometry"]["coordinates"]],
                "distance_km": round(result["distance"] / 1000, 2),
                "duration_min": round(result["duration"] / 60, 1),
            }
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 502
    return jsonify({"routes": geometries, "source": "OSRM driving network"})

@app.route("/api/places", methods=["GET"])
def api_places():
    global last_place_request
    query = request.args.get("q", "").strip()
    if len(query) < 3:
        return jsonify({"places": []})

    cache_key = query.casefold()
    if cache_key in place_cache:
        return jsonify({"places": place_cache[cache_key]})

    params = urllib.parse.urlencode({
        "q": f"{query}, Hyderabad, Telangana, India",
        "format": "jsonv2",
        "limit": 6,
        "addressdetails": 1,
        "countrycodes": "in",
        "viewbox": "78.20,17.60,78.70,17.20",
        "bounded": 1,
    })
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{params}",
        headers={"Accept": "application/json", "User-Agent": "AlgoForgeSchoolBusPlanner/1.0"},
    )
    try:
        with place_cache_lock:
            delay = 1.0 - (time.monotonic() - last_place_request)
            if delay > 0:
                time.sleep(delay)
            with urllib.request.urlopen(req, timeout=12) as response:
                payload = json.load(response)
            last_place_request = time.monotonic()
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        return jsonify({"error": "OpenStreetMap place search is temporarily unavailable"}), 502

    places = []
    for item in payload:
        address = item.get("address", {})
        places.append({
            "name": item.get("name") or item.get("display_name", "").split(",")[0],
            "display_name": item.get("display_name", ""),
            "locality": address.get("suburb") or address.get("city_district") or address.get("city") or "Hyderabad",
            "latitude": float(item["lat"]),
            "longitude": float(item["lon"]),
        })
    place_cache[cache_key] = places
    return jsonify({"places": places})

@app.route("/api/stops", methods=["POST"])
def api_add_stop():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400

    name = data.get("name")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 60:
        return jsonify({"error": "Stop name is required and must be 60 characters or fewer"}), 400

    raw_demand = data.get("demand")
    raw_priority = data.get("priority")
    try:
        if isinstance(raw_demand, bool) or isinstance(raw_priority, bool):
            raise ValueError
        demand = int(raw_demand)
        priority = int(raw_priority)
        if float(raw_demand) != demand or float(raw_priority) != priority:
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Demand and priority must be whole numbers"}), 400

    if demand < 1 or demand > max(bus["capacity"] for bus in planner.buses):
        return jsonify({"error": "Demand must fit at least one bus"}), 400
    if priority < 1 or priority > 5:
        return jsonify({"error": "Priority must be between 1 and 5"}), 400

    latitude = data.get("latitude")
    longitude = data.get("longitude")
    if latitude is None or longitude is None:
        return jsonify({"error": "Select a mapped Hyderabad place before adding the stop"}), 400
    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return jsonify({"error": "Selected place coordinates are invalid"}), 400
    south, west, north, east = HYDERABAD_BOUNDS
    if not (math.isfinite(latitude) and math.isfinite(longitude) and south <= latitude <= north and west <= longitude <= east):
        return jsonify({"error": "Selected place must be inside the Hyderabad service area"}), 400

    def coordinate_distance(stop: dict) -> float:
        stop_lat = stop["latitude"]
        stop_lon = stop["longitude"]
        lat_delta = math.radians(stop_lat - latitude)
        lon_delta = math.radians(stop_lon - longitude)
        haversine = math.sin(lat_delta / 2) ** 2 + math.cos(math.radians(latitude)) * math.cos(math.radians(stop_lat)) * math.sin(lon_delta / 2) ** 2
        return 6371 * 2 * math.asin(math.sqrt(haversine))

    connected_to = min(planner.stops, key=lambda stop_id: coordinate_distance(planner.stops[stop_id]))
    anchor = planner.stops[connected_to]
    try:
        route_data = _osrm_request(
            "route",
            [(anchor["longitude"], anchor["latitude"]), (longitude, latitude)],
            "overview=false&steps=false",
        )
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 502
    distance_km = round(route_data["routes"][0]["distance"] / 1000, 3)
    if distance_km <= 0:
        return jsonify({"error": "The selected place has no drivable connection to the current route network"}), 400

    stop = planner.add_stop(name.strip(), demand, priority, connected_to, distance_km, latitude, longitude)
    return jsonify({"stop": stop}), 201

@app.route("/api/roads/weights", methods=["PUT"])
def api_update_road_weights():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not isinstance(data.get("roads"), list):
        return jsonify({"error": "Request body must contain a roads array"}), 400

    updated = {}
    for road in data["roads"]:
        if not isinstance(road, dict):
            return jsonify({"error": "Each road update must be an object"}), 400
        source, target = road.get("u"), road.get("v")
        try:
            distance = float(road.get("dist"))
        except (TypeError, ValueError):
            return jsonify({"error": "Road distances must be positive numbers"}), 400
        if source not in planner.stops or target not in planner.stops or not math.isfinite(distance) or distance <= 0:
            return jsonify({"error": "Road update contains an invalid stop or distance"}), 400
        updated[frozenset((source, target))] = distance

    expected = {frozenset((source, target)) for source, target, _ in planner.roads}
    if updated.keys() != expected:
        return jsonify({"error": "Provide one distance update for every existing road"}), 400

    planner.roads = [(source, target, updated[frozenset((source, target))]) for source, target, _ in planner.roads]
    planner.adj = planner._build_adjacency()
    return jsonify({"updated_roads": len(planner.roads)})

@app.route("/api/bfs", methods=["GET"])
def api_bfs():
    source = request.args.get("source", "DEPOT")
    if source not in planner.stops:
        return jsonify({"error": f"Unknown source stop: {source}"}), 400
    return jsonify(planner.run_bfs(source))

@app.route("/api/dijkstra", methods=["GET"])
def api_dijkstra():
    src = request.args.get("source", "DEPOT")
    if src not in planner.stops:
        return jsonify({"error": f"Unknown source stop: {src}"}), 400
    dist, _, trace = planner.run_dijkstra(src)
    return jsonify({"source": src, "distances": dist, "trace": trace})

@app.route("/api/solve", methods=["POST"])
def api_solve():
    data = request.get_json(silent=True)
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object"}), 400

    try:
        alpha = float(data.get("alpha", 1.0))
        beta = float(data.get("beta", 2.0))
    except (TypeError, ValueError):
        return jsonify({"error": "alpha and beta must be numbers"}), 400

    if not math.isfinite(alpha) or not math.isfinite(beta) or alpha < 0 or beta < 0:
        return jsonify({"error": "alpha and beta must be finite, non-negative numbers"}), 400

    return jsonify(planner.solve_routes(alpha, beta))

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)