import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/192.png", "icons/512.png", "icons/maskable.png"],
      manifest: {
        name: "OpenGraphXEM",
        short_name: "OpenGraphXEM",
        description: "OpenGraphXEM — AI code review against a 224-rule production ruleset.",
        start_url: "/",
        display: "standalone",
        orientation: "any",
        theme_color: "#3D5520",
        background_color: "#0a0a0a",
        icons: [
          { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkOnly"
          }
        ]
      }
    })
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") }
  },
  server: { host: "0.0.0.0", port: 5173 }
});
