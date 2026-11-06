import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

const api = process.env.PERSONA_API ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Persona.AI",
        short_name: "Persona",
        description: "Self-hosted AI character chat",
        theme_color: "#1b1a2b",
        background_color: "#1b1a2b",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/media/images/"),
            handler: "CacheFirst",
            options: { cacheName: "persona-images", expiration: { maxEntries: 500 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, ws: true, changeOrigin: false },
      "/media": { target: api },
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
});
