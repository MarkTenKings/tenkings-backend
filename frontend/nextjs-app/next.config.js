const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const aiGraderCalibrationSharpRuntimeFiles = [
  "../../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/**/*",
  "../../node_modules/.pnpm/@img+sharp-linux-x64@*/node_modules/@img/sharp-linux-x64/**/*",
  "../../node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/**/*",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@tenkings/database", "@tenkings/shared"],
  experimental: {
    outputFileTracingRoot: repositoryRoot,
    outputFileTracingIncludes: {
      "/api/admin/ai-grader/calibration-snapshots/**": aiGraderCalibrationSharpRuntimeFiles,
      "/api/admin/ai-grader/calibration-activations/**": aiGraderCalibrationSharpRuntimeFiles,
      "/api/ai-grader/calibration-activation/status": aiGraderCalibrationSharpRuntimeFiles,
    },
  },
  env: {
    NEXT_PUBLIC_ELEVENLABS_AGENT_ID: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? process.env.ELEVENLABS_AGENT_ID ?? "",
  },
  async redirects() {
    return [
      {
        source: "/admin/inventory-ready",
        destination: "/admin/inventory",
        permanent: true,
      },
      {
        source: "/admin/location-batches",
        destination: "/admin/assigned-locations",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.cdn.digitaloceanspaces.com",
      },
      {
        protocol: "https",
        hostname: "**.digitaloceanspaces.com",
      },
    ],
  },
};

module.exports = nextConfig;
