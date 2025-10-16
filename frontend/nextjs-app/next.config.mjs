import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  experimental: {
    // Ensure output file tracing includes workspace packages when building the
    // standalone bundle inside the monorepo Docker image.
    outputFileTracingRoot: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
