import type { NextConfig } from "next";

// One id per deploy. Netlify sets COMMIT_REF during builds; the fallback keeps local builds working.
// It's baked into the app bundle AND written to /version.json, so an open tab can tell when a
// newer version has been deployed (see UpdateBanner in app/page.tsx).
const buildId = process.env.COMMIT_REF || process.env.BUILD_ID || `local-${Date.now()}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
};

export default nextConfig;
