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
      "@shared": path.resolve(__dirname, "../shared"),
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
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
