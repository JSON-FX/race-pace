import type { NextConfig } from "next";

// Read at BUILD time. If NEXT_PUBLIC_SUPABASE_URL is unset in the Vercel
// project before the first build, no Supabase pattern is emitted and every
// org logo / event hero 400s in production while local dev works fine.
// Adding the var later requires a REDEPLOY, not just an env edit.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : "";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https" as const, hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
};

export default nextConfig;
