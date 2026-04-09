/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@tenkings/database", "@tenkings/shared"],
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
