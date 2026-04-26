import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { vibecodePlugin } from "@vibecodeapp/webapp/plugin";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8000,
    allowedHosts: true, // Allow all hosts
  },
  plugins: [
    react(),
    mode === "development" && vibecodePlugin(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    // Needed for legacy CJS packages that check process.env.NODE_ENV
    "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
    global: "globalThis",
  },
  optimizeDeps: {
    include: [
      "buffer",
      "bs58",
    ],
    // These packages are ESM-only and must not go through esbuild CJS transform
    exclude: [
      "@coinbase/wallet-sdk",
      "@privy-io/react-auth",
      "@privy-io/js-sdk-core",
    ],
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  build: {
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter(
          (dep) =>
            !dep.includes("vendor-core-") &&
            !dep.includes("vendor-wallet-auth-") &&
            !dep.includes("vendor-charts-") &&
            !dep.includes("vendor-solana-") &&
            !dep.includes("TokenTelemetryCharts-") &&
            !dep.includes("Terminal-") &&
            !dep.includes("TokenPage-")
        );
      },
    },
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          if (id.includes("recharts") || id.includes("d3-") || id.includes("lightweight-charts")) {
            return "vendor-charts";
          }
          if (id.includes("@privy-io") || id.includes("@walletconnect") || id.includes("@coinbase") || id.includes("@toruslabs")) {
            return "vendor-wallet-auth";
          }
          if (
            id.includes("@solana") ||
            id.includes("@coral-xyz") ||
            id.includes("@project-serum") ||
            id.includes("bs58") ||
            id.includes("buffer/")
          ) {
            return "vendor-solana";
          }
          if (id.includes("framer-motion")) {
            return "vendor-motion";
          }
          if (id.includes("@tanstack")) {
            return "vendor-query";
          }
          if (id.includes("react") || id.includes("react-dom") || id.includes("react-router")) {
            return "vendor-react";
          }
          return "vendor-core";
        },
      },
    },
  },
}));
