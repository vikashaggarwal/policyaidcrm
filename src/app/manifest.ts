import type { MetadataRoute } from "next";

// A home-screen shortcut only. There is deliberately no service worker: lead data is live and personal,
// so nothing is cached for offline use.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PolicyAid CRM",
    short_name: "PolicyAid",
    description: "Call queue and pipeline for the tele-sales team.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#f6f7f9",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
