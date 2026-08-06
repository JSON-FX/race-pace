import { render, act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { Toaster } from "../components/ui/sonner";

function getToasterTheme() {
  return document.querySelector("[data-sonner-toaster]")?.getAttribute("data-sonner-theme");
}

async function renderWithAToast() {
  render(<Toaster />);
  act(() => {
    toast("hello");
  });
  await waitFor(() => {
    expect(document.querySelector("[data-sonner-toaster]")).not.toBeNull();
  });
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
});

it("renders light when <html> has no .dark class", async () => {
  await renderWithAToast();
  expect(getToasterTheme()).toBe("light");
});

it("renders dark when <html> already has .dark on mount", async () => {
  document.documentElement.classList.add("dark");
  await renderWithAToast();
  expect(getToasterTheme()).toBe("dark");
});

it("follows a theme switch that happens after mount, not just at mount time", async () => {
  await renderWithAToast();
  expect(getToasterTheme()).toBe("light");

  act(() => {
    document.documentElement.classList.add("dark");
  });
  await waitFor(() => {
    expect(getToasterTheme()).toBe("dark");
  });

  act(() => {
    document.documentElement.classList.remove("dark");
  });
  await waitFor(() => {
    expect(getToasterTheme()).toBe("light");
  });
});
