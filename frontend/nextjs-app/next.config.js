/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@tenkings/database", "@tenkings/shared"],
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
