import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoogleButton } from "./google-button";
import { OAUTH_NEXT_COOKIE } from "@/lib/routes";

const signInWithOAuth = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithOAuth: (...a: unknown[]) => signInWithOAuth(...a) } }),
}));

beforeEach(() => {
  signInWithOAuth.mockReset();
  signInWithOAuth.mockResolvedValue({ error: null });
  // Clear anything a previous test wrote.
  document.cookie = `${OAUTH_NEXT_COOKIE}=; path=/; max-age=0`;
});

describe("GoogleButton", () => {
  it("sends redirectTo with NO query string", async () => {
    // The rule this locks down, learned on apps/site: Supabase matches
    // redirectTo against the dashboard's Redirect URLs allow-list as a WHOLE
    // STRING. A `?next=` appended here fails the match, and Supabase then
    // silently falls back to the project's Site URL — which is the runner site,
    // so an admin lands on the public homepage with no error shown anywhere.
    render(<GoogleButton next="/payouts" />);
    await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));

    const arg = signInWithOAuth.mock.calls[0]![0] as { provider: string; options: { redirectTo: string } };
    expect(arg.provider).toBe("google");
    expect(arg.options.redirectTo).not.toContain("?");
    expect(arg.options.redirectTo.endsWith("/auth/callback")).toBe(true);
  });

  it("carries the destination in a cookie instead", async () => {
    render(<GoogleButton next="/payouts" />);
    await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));

    expect(document.cookie).toContain(`${OAUTH_NEXT_COOKIE}=${encodeURIComponent("/payouts")}`);
  });

  it("surfaces a provider failure instead of leaving a dead button", async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: "provider is not enabled" } });
    render(<GoogleButton next="/events" />);
    await userEvent.click(screen.getByRole("button", { name: /sign in with google/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("re-enables the button after a failure so it can be retried", async () => {
    signInWithOAuth.mockResolvedValue({ error: { message: "nope" } });
    render(<GoogleButton next="/events" />);
    const btn = screen.getByRole("button", { name: /sign in with google/i });
    await userEvent.click(btn);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with google/i })).not.toBeDisabled();
  });
});
