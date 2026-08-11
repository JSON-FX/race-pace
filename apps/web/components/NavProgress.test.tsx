import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavProgressProvider, NavProgressBar, useReportPending } from "./NavProgress";

function Reporter({ pending }: { pending: boolean }) {
  useReportPending(pending);
  return null;
}

/** Two independent reporters plus a toggle for each, so a test can assert the
 *  counter semantics the bar depends on: the bar must stay up while ANY
 *  reporter is pending, which a boolean (rather than a count) would get wrong. */
function Harness() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <NavProgressProvider>
      <NavProgressBar />
      <Reporter pending={a} />
      <Reporter pending={b} />
      <button onClick={() => setA((v) => !v)}>toggle a</button>
      <button onClick={() => setB((v) => !v)}>toggle b</button>
    </NavProgressProvider>
  );
}

const bar = () => screen.queryByRole("progressbar", { name: "Loading page" });

describe("useReportPending", () => {
  it("shows the bar while pending and hides it when it clears", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(bar()).not.toBeInTheDocument();

    await user.click(screen.getByText("toggle a"));
    expect(bar()).toBeInTheDocument();

    await user.click(screen.getByText("toggle a"));
    expect(bar()).not.toBeInTheDocument();
  });

  // The regression this pins: with a boolean instead of a counter, resolving
  // the FIRST of two overlapping navigations would clear the bar while the
  // second is still in flight.
  it("keeps the bar up until every reporter has cleared", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByText("toggle a"));
    await user.click(screen.getByText("toggle b"));
    expect(bar()).toBeInTheDocument();

    await user.click(screen.getByText("toggle a"));
    expect(bar()).toBeInTheDocument();

    await user.click(screen.getByText("toggle b"));
    expect(bar()).not.toBeInTheDocument();
  });

  // useTableParams calls this hook, and lib/use-table-params.test.ts renders
  // that hook with no provider anywhere in the tree.
  it("is safe to call with no provider mounted", () => {
    expect(() => render(<Reporter pending />)).not.toThrow();
  });
});
