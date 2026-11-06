import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WorkHub is a fully authenticated, per-user dashboard: every page depends on the
  // session and live MongoDB data, so classic dynamic rendering is the right model.
  cacheComponents: false,
  serverExternalPackages: ["mongoose", "bcryptjs"],
  poweredByHeader: false,
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
