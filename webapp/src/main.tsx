// Polyfills for Solana wallet adapter
import { Buffer } from "buffer";
window.Buffer = Buffer;

if (typeof window !== "undefined") {
  const host = window.location.hostname.toLowerCase();
  const redirectToCanonicalHost = () => {
    try {
      const sessionKeys: string[] = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (typeof key === "string" && key.startsWith("phew.")) {
          sessionKeys.push(key);
        }
      }
      for (const key of sessionKeys) {
        window.sessionStorage.removeItem(key);
      }
    } catch {
      // ignore storage access errors in private browsing
    }

    try {
      window.localStorage.removeItem("auth-token");
    } catch {
      // ignore storage access errors in private browsing
    }

    const redirectUrl =
      `https://phew.run${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(redirectUrl);
  };
  const isVercelPreviewHost =
    host.endsWith(".vercel.app") &&
    host !== "phew.run" &&
    host !== "www.phew.run" &&
    !host.endsWith(".phew.run");

  if (host === "www.phew.run") {
    redirectToCanonicalHost();
  }

  if (isVercelPreviewHost) {
    redirectToCanonicalHost();
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
