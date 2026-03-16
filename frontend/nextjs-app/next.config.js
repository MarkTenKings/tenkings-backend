/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@tenkings/database", "@tenkings/shared"],
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
