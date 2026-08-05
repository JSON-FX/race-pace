import { describe, it, expect, vi, beforeEach } from "vitest";
import { OAUTH_NEXT_COOKIE } from "@/lib/routes";
import { signInWithGoogle } from "@/lib/auth";

const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } }),
}));

beforeEach(() => {
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ error: null });
  // Clear any cookie a previous test wrote.
  document.cookie = `${OAUTH_NEXT_COOKIE}=; path=/; max-age=0`;
});

describe("signInWithGoogle", () => {
  it("sends a redirectTo with NO query string", async () => {
    // The regression this guards: `…/auth/callback?next=%2Fraces` does not
    // match a registered `…/auth/callback` in Supabase's Redirect URLs
    // allow-list. Supabase then silently falls back to the project's Site URL,
    // stranding the runner on `http://localhost:3000/?code=…`. The failure is
    // invisible locally if Site URL happens to be your dev origin, so assert
    // the shape here rather than trusting a manual click-through.
    await signInWithGoogle("/races");

    const { options } = signInWithOAuth.mock.calls[0]![0] as { options: { redirectTo: string } };
    expect(options.redirectTo).toBe("http://localhost:3000/auth/callback");
    expect(options.redirectTo).not.toContain("?");
  });

  it("carries the destination in a cookie instead", async () => {
    await signInWithGoogle("/races");

    expect(document.cookie).toContain(`${OAUTH_NEXT_COOKIE}=%2Fraces`);
  });

  it("requests the google provider and reports errors", async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: "provider is not enabled" } });

    const result = await signInWithGoogle("/");

    expect((signInWithOAuth.mock.calls[0]![0] as { provider: string }).provider).toBe("google");
    expect(result.error).toBe("provider is not enabled");
  });
});
