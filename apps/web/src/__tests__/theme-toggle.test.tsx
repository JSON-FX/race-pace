import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "../components/ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

it("adds .dark to <html> and persists the choice", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByLabelText("Toggle dark mode"));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem("rp-theme")).toBe("dark");
});

it("toggles back to light and persists that too", () => {
  localStorage.setItem("rp-theme", "dark");
  document.documentElement.classList.add("dark");
  render(<ThemeToggle />);
  fireEvent.click(screen.getByLabelText("Toggle dark mode"));
  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem("rp-theme")).toBe("light");
});
