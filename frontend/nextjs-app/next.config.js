/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@tenkings/database", "@tenkings/shared"],
  async redirects() {
    return [
      // TODO(step-16): remove once /live public redesign lands.
      // /live still renders the interim public list in this commit, so the admin
      // bookmark handoff stays in pages/live.tsx instead of an unconditional
      // redirect here.
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
