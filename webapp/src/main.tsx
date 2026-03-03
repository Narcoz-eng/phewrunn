// Polyfills for Solana wallet adapter
import { Buffer } from "buffer";
window.Buffer = Buffer;

if (typeof window !== "undefined") {
  const host = window.location.hostname.toLowerCase();
  const isVercelPreviewHost =
    host.endsWith(".vercel.app") &&
    host !== "phew.run" &&
    host !== "www.phew.run" &&
    !host.endsWith(".phew.run");

  if (isVercelPreviewHost) {
    const redirectUrl =
      `https://www.phew.run${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(redirectUrl);
  }
}

import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import App from "./App.js";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
