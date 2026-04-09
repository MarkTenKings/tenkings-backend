import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Ensure output file tracing includes workspace packages when building the
    // standalone bundle inside the monorepo Docker image.
    outputFileTracingRoot: path.join(__dirname, "../.."),
  },
  env: {
    NEXT_PUBLIC_ELEVENLABS_AGENT_ID: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? process.env.ELEVENLABS_AGENT_ID ?? "",
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

export default nextConfig;
