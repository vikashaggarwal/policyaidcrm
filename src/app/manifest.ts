import type { MetadataRoute } from "next";

// A home-screen shortcut only. There is deliberately no service worker: lead data is live and personal,
// so nothing is cached for offline use.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dial Desk",
    short_name: "Dial Desk",
    description: "Call queue and pipeline for the tele-sales team.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7f9",
    theme_color: "#0b5fd6",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
