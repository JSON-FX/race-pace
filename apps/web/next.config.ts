import type { NextConfig } from "next";

// Read at BUILD time. If NEXT_PUBLIC_SUPABASE_URL is unset in the Vercel
// project before the first build, no Supabase pattern is emitted and every
// org logo / event hero 400s in production while local dev works fine.
// Adding the var later requires a REDEPLOY, not just an env edit.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
  : null;

// Docker cannot optimize a browser-facing loopback URL; fetch local images in the browser.
const nextConfig: NextConfig = {
  images: {
    unoptimized: process.env.NODE_ENV === "development" && supabaseUrl?.protocol === "http:",
    remotePatterns: supabaseUrl
      ? [{ protocol: supabaseUrl.protocol.slice(0, -1) as "http" | "https", hostname: supabaseUrl.hostname, port: supabaseUrl.port, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
};

export default nextConfig;
