import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("#root element not found");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Milestone 5 (PLAN.md §11): registers the app-shell cache worker (public/sw.js)
// so a repeat visit can still load the app itself with the network gone.
// Registration failure (unsupported browser, blocked by a privacy setting)
// is logged, never thrown — the app must work identically without it, just
// without the offline-boot guarantee.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("service worker registration failed:", err);
    });
  });
}
