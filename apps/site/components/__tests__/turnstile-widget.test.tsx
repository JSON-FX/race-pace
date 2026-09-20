import { act, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnstileWidget } from "../TurnstileWidget";

const originalKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

describe("TurnstileWidget", () => {
  const renderWidget = vi.fn();
  const reset = vi.fn();
  const remove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    renderWidget.mockReturnValue("widget-1");
    window.turnstile = { render: renderWidget, reset, remove };
  });

  it("returns and expires one-time tokens", async () => {
    const onTokenChange = vi.fn();
    render(<TurnstileWidget action="runner_sign_in" onTokenChange={onTokenChange} />);
    await waitFor(() => expect(renderWidget).toHaveBeenCalled());
    expect(onTokenChange).not.toHaveBeenCalled();
    const options = renderWidget.mock.calls[0][1];

    act(() => options.callback("token"));
    expect(onTokenChange).toHaveBeenLastCalledWith("token");
    act(() => options["expired-callback"]());
    expect(onTokenChange).toHaveBeenLastCalledWith(null);
  });

  it("shows a retry message when provider verification fails", async () => {
    render(<TurnstileWidget action="runner_sign_in" onTokenChange={vi.fn()} />);
    await waitFor(() => expect(renderWidget).toHaveBeenCalled());
    act(() => renderWidget.mock.calls[0][1]["error-callback"]());
    expect(screen.getByRole("alert")).toHaveTextContent("Refresh and try again");
  });

  it("resets the provider when resetKey changes", async () => {
    const onTokenChange = vi.fn();
    const view = render(<TurnstileWidget action="runner_sign_in" onTokenChange={onTokenChange} resetKey={0} />);
    await waitFor(() => expect(renderWidget).toHaveBeenCalled());
    view.rerender(<TurnstileWidget action="runner_sign_in" onTokenChange={onTokenChange} resetKey={1} />);
    expect(reset).toHaveBeenCalledWith("widget-1");
    expect(onTokenChange).toHaveBeenLastCalledWith(null);
  });

  it("fails closed when no site key is configured", () => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    window.turnstile = undefined;
    render(<TurnstileWidget action="runner_sign_in" onTokenChange={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("temporarily unavailable");
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalKey;
  });
});
