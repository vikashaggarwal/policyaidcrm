import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lead imports send 500 rows per request; the default 1 MB cap is too tight for long addresses.
  // Vercel itself rejects bodies over 4.5 MB, so stay under that.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
