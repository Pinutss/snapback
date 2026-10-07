import "@fontsource-variable/figtree";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dev-only handle for scripted testing (stripped from production builds).
if (import.meta.env.DEV) {
  import("./store").then(({ useStore }) => ((window as unknown as { __snapback: unknown }).__snapback = useStore));
}

// Offline support + installability. Dev builds skip it so hot reload is never served from cache.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("[snapback] service worker", err));
  });
}
