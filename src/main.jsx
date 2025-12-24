import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Register the service worker for PWA installability/offline support.
// Note: This only fully works in production builds (and in dev on localhost),
// and browsers may not show an automatic install prompt anymore — we'll surface
// our own "Install" button in the UI when the prompt is available.
import { registerSW } from "virtual:pwa-register";

registerSW({
  immediate: true
});

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

