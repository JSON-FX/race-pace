import type { NextConfig } from "next";

// NOTE: this is read at BUILD time. If NEXT_PUBLIC_SUPABASE_URL is not set in
// the Vercel project BEFORE the first build, no Supabase pattern is emitted and
// every real event image 400s in production — with local dev working fine, so
// the breakage is invisible until you load the deployed site. Adding the var
// later requires a REDEPLOY, not just an env edit.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
  : "";

const remotePatterns: NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> = [
  // Placeholder photography while organizers upload their own race images.
  // Safe to remove once every event has a hero in Supabase Storage.
  { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
];

// Event hero images, org logos, and runner avatars are served from Supabase Storage.
if (supabaseHost) {
  remotePatterns.push({ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" });
}

const nextConfig: NextConfig = { images: { remotePatterns } };

export default nextConfig;
