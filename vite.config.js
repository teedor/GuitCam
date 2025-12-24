import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // We'll register the SW ourselves in src/main.jsx so we can
      // keep control of update behavior and keep it explicit.
      injectRegister: null,
      registerType: "autoUpdate",
      // Enable PWA behavior on `vite dev` (localhost is treated as secure).
      // This makes it much easier to see the install prompt during development.
      devOptions: {
        enabled: true
      },
      manifest: {
        name: "High-Fidelity Video Recorder",
        short_name: "Video Recorder",
        description: "High-fidelity in-browser video recorder with raw mic audio.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0a0a0a",
        theme_color: "#0a0a0a",
        icons: [
          {
            src: "/pwa-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    strictPort: true
  }
});

