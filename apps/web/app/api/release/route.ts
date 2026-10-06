// Materialized at build time: runtime settings must not rewrite release identity.
export const dynamic = "force-static";

export function GET() {
  return Response.json({
    app: "web",
    sha: process.env.NEXT_PUBLIC_RELEASE_SHA ?? null,
    supabaseProject: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]
      : null,
  });
}
