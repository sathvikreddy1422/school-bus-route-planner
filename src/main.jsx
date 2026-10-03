import React from "react";
import { createRoot } from "react-dom/client";
import SchoolBusPlanner from "./Planner.jsx";
import "leaflet/dist/leaflet.css";
import "./style.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SchoolBusPlanner />
  </React.StrictMode>,
);