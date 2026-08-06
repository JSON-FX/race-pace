import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { ThemeToggle } from "./ThemeToggle";

// ThemeToggle is a thin wrapper over next-themes' useTheme — the app's real
// dark-mode state lives in next-themes' ThemeProvider (app/layout.tsx), not
// in a bespoke .dark-class toggle, so these tests render through the same
// provider rather than asserting on localStorage keys the component doesn't
// own.
function renderToggle(defaultTheme: "light" | "dark") {
  return render(
    <ThemeProvider attribute="class" defaultTheme={defaultTheme} enableSystem={false} disableTransitionOnChange>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
});

it("adds .dark to <html> and persists the choice", async () => {
  renderToggle("light");
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
  fireEvent.click(screen.getByLabelText("Toggle dark mode"));
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  expect(localStorage.getItem("theme")).toBe("dark");
});

it("toggles back to light and persists that too", async () => {
  renderToggle("dark");
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
  fireEvent.click(screen.getByLabelText("Toggle dark mode"));
  await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(false));
  expect(localStorage.getItem("theme")).toBe("light");
});
