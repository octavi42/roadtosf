import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Prefer this app as the tracing root when multiple lockfiles exist (e.g. ~/package-lock.json).
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ['roadtosf.localhost', '*.roadtosf.localhost'],
};

export default nextConfig;
