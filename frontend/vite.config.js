import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Proxy API calls to the backend during development.
    // Use 127.0.0.1 (not "localhost") so Windows doesn't resolve to IPv6 ::1
    // and fail to reach an IPv4-bound backend (causes 502s in the dev proxy).
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
});
