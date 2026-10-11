import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    ...(process.env.REPLIT_DEV_DOMAIN ? [process.env.REPLIT_DEV_DOMAIN] : []),
    "127.0.0.1", "localhost", "*.replit.dev", "*.replit.app", "*.repl.co",
  ],
  serverExternalPackages: ["pg", "pg-boss"],
  // Incoming URLs can contain private document identifiers or invitation tokens.
  logging: { incomingRequests: false },
  transpilePackages: ["@workspace/contracts", "@workspace/core", "@workspace/database"],
};

export default nextConfig;
