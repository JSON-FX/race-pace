import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const replace = vi.hoisted(() => vi.fn());
const setSession = vi.hoisted(() => vi.fn());
const searchParams = vi.hoisted(() => new URLSearchParams());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { setSession } }),
}));

import ConfirmFinishPage from "./page";

function withHash(hash: string) {
  window.location.hash = hash;
}

beforeEach(() => {
  replace.mockReset();
  setSession.mockReset().mockResolvedValue({ error: null });
  searchParams.forEach((_, k) => searchParams.delete(k));
  window.location.hash = "";
});

describe("GET /auth/confirm/finish", () => {
  // The production incident this page exists for: Supabase's default invite
  // template routes through /auth/v1/verify and delivers the session on the
  // fragment, which never reaches the server.
  it("establishes the session from the URL fragment and lands on /team", async () => {
    withHash("#access_token=at-123&refresh_token=rt-456&type=invite");
    render(<ConfirmFinishPage />);

    await waitFor(() =>
      expect(setSession).toHaveBeenCalledWith({ access_token: "at-123", refresh_token: "rt-456" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/team"));
  });

  it("honours an explicit ?next=, and refuses an absolute one", async () => {
    withHash("#access_token=at-123&refresh_token=rt-456");
    searchParams.set("next", "/events");
    render(<ConfirmFinishPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/events"));

    replace.mockReset();
    searchParams.set("next", "https://evil.example");
    window.location.hash = "#access_token=at-123&refresh_token=rt-456";
    render(<ConfirmFinishPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/team"));
  });

  it("sends a link carrying an error on the fragment back to login", async () => {
    withHash("#error=access_denied&error_description=Email+link+is+invalid+or+has+expired");
    render(<ConfirmFinishPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?oauth=invite_expired"));
    expect(setSession).not.toHaveBeenCalled();
  });

  it("does not call setSession when the fragment carries no tokens", async () => {
    withHash("");
    render(<ConfirmFinishPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?oauth=invite_expired"));
    expect(setSession).not.toHaveBeenCalled();
  });

  it("sends a rejected token back to login rather than a blank screen", async () => {
    withHash("#access_token=at-123&refresh_token=rt-456");
    setSession.mockResolvedValue({ error: { message: "Invalid Refresh Token" } });
    render(<ConfirmFinishPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?oauth=invite_expired"));
  });
});
