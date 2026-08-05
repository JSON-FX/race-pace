import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Next's router is unavailable under jsdom; components under test that
// navigate get a stub they can assert against.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
}));
